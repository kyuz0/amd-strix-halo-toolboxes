#!/usr/bin/python3
"""Container entry points for Maya's native GLM and DeepSeek servers."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

SOURCE = Path('/opt/maya')


def configuration(args):
    pack = Path(args.pack).expanduser().resolve()
    if not pack.is_dir():
        raise ValueError(f'Prepared model directory does not exist: {pack}')
    if not 2048 <= args.context <= 68096:
        raise ValueError('Context must be between 2048 and 68096 tokens')
    env = {}
    if args.family == 'glm':
        if args.mode not in ('baseline', 'mtp'):
            raise ValueError('GLM supports baseline or MTP')
        exe = SOURCE / 'build-hip/ds4-server-maya-glm'
        native = ['--glm-pack', str(pack), '--max-context', str(args.context),
                  '--expert-cache', 'auto', '--prefill', 'auto', '--kv-streaming', 'on']
        env = {'STRATA_GLM_RESERVE_MB': '1024', 'STRATA_GLM_RAM_HEADROOM_GB': '16',
               'STRATA_GLM_SPLIT': '0', 'STRATA_GLM_PREFILL_SUB': '1024',
               'STRATA_GLM_PREFILL_MB': '6144',
               'STRATA_GLM_MTP_DECODE': '1' if args.mode == 'mtp' else '0'}
        if args.mode == 'mtp':
            env.update(STRATA_GLM_MTP_DRAFT='3', STRATA_GLM_MTP_ADAPT='1')
        tables = sorted((SOURCE / 'tools/hip').glob('gfx1151-glm-hipblaslt-*.txt'))
        if tables:
            env['STRATA_HIPBLASLT_TUNING'] = ':'.join(map(str, tables))
    else:
        if args.mode not in ('baseline', 'dspark'):
            raise ValueError('DeepSeek supports baseline or DSpark')
        exe = SOURCE / 'build-hip/ds4-server-maya'
        native = ['--pack', str(pack), '--max-context', str(args.context),
                  '--vram-experts', '0.5', '--reserve-mib', '4096', '--mmap-experts', 'on',
                  '--vision', 'off', '--tp', '1', '--suffix-draft', '0', '--dspark', 'on' if args.mode == 'dspark' else 'none']
        if args.mode == 'dspark':
            env['DS4_DSPARK_MAX'] = '5'
    return {'exe': str(exe), 'args': native, 'cwd': str(SOURCE),
            'tokenizer': str(pack / 'tokenizer'), 'model_name': args.model_name,
            'backend': 'hip', 'gpu': [0], 'env': env, 'log': '/dev/stderr',
            'sampling': {'temperature': 1.0, 'top_p': 0.95 if args.family == 'glm' else 1.0,
                         'top_k': 64, 'min_p': 0.0}, 'reasoning_effort': 'high'}


def serve():
    parser = argparse.ArgumentParser(description='Serve a prepared Maya model on one Strix Halo APU.')
    parser.add_argument('--family', choices=['glm', 'deepseek'], required=True)
    parser.add_argument('--pack', required=True)
    parser.add_argument('--model-name', required=True)
    parser.add_argument('--context', type=int, default=68096)
    parser.add_argument('--mode', choices=['baseline', 'mtp', 'dspark'], default='baseline')
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8000)
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error('Invalid API port')
    try:
        cfg = configuration(args)
    except ValueError as error:
        parser.error(str(error))
    runtime = Path(tempfile.mkdtemp(prefix='maya-server-'))
    path = runtime / 'config.json'
    path.write_text(json.dumps(cfg, indent=2) + '\n')
    print(f'Maya {args.family}: {args.model_name}, {args.mode}, {args.context} tokens', flush=True)
    os.execv(sys.executable, [sys.executable, str(SOURCE / 'serve/server.py'),
                             '--engine', 'maya', '--config', str(path),
                             '--host', args.host, '--port', str(args.port)])


def prepare():
    parser = argparse.ArgumentParser(description='Prepare Maya metadata and tokenizer from downloaded GGUFs.')
    parser.add_argument('--family', choices=['glm', 'deepseek'], required=True)
    parser.add_argument('--model', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--drafter', type=Path)
    args = parser.parse_args()
    model, output = args.model.expanduser().resolve(), args.output.expanduser().resolve()
    if args.family == 'glm':
        command = [sys.executable, str(SOURCE / 'tools/iq_pack.py'), '--gguf', str(model),
                   '--out', str(output), '--compat-bf16']
    else:
        command = [sys.executable, str(SOURCE / 'tools/ds4/pack_gguf.py'), '--model', str(model),
                   '--out', str(output)]
        if args.drafter:
            command += ['--drafter', str(args.drafter.expanduser().resolve())]
    subprocess.run(command, cwd=SOURCE, check=True)
    print(f'Maya pack ready: {output}', flush=True)


if __name__ == '__main__':
    name = Path(sys.argv[0]).name
    if name == 'maya-version':
        print((SOURCE / 'toolbox-provenance.json').read_text())
    elif name == 'maya-prepare':
        prepare()
    else:
        serve()
