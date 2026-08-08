import js from '@eslint/js'
import react from 'eslint-plugin-react'

/**
 * The one rule that really matters here is the ban on `shell: true`.
 *
 * Everything this app runs takes user input — model paths, API keys, image
 * references — and hands it to podman, hf or git. With an argv array that is
 * safe by construction; the moment a shell is involved it is not, and the
 * mistake is easy to make and hard to spot in review.
 */
export default [
  js.configs.recommended,
  {
    files: ['**/*.js', '**/*.jsx', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        AbortController: 'readonly',
        TextDecoder: 'readonly',
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        EventSource: 'readonly',
      },
    },
    plugins: { react },
    rules: {
      // Without this, every component imported for JSX looks unused.
      'react/jsx-uses-vars': 'error',
      'react/jsx-uses-react': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: "Property[key.name='shell'][value.value=true]",
          message:
            'shell: true ist verboten. Nutze execFile/spawn mit einem Argv-Array (siehe server/src/lib/exec.js).',
        },
        {
          selector: "CallExpression[callee.property.name='exec'][callee.object.name='child_process']",
          message: 'child_process.exec interpretiert eine Shell. Nutze execFile über lib/exec.js.',
        },
      ],
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          // `const { id, ...body } = form` to strip a field is intentional.
          ignoreRestSiblings: true,
        },
      ],
      'no-console': 'off',
    },
  },
  {
    ignores: ['**/node_modules/**', '**/dist/**', 'dev/tmp/**'],
  },
]
