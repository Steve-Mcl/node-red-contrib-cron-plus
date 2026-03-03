import globals from 'globals'
import html from 'eslint-plugin-html'
import js from '@eslint/js'
import neostandard, { resolveIgnoresFromGitignore } from 'neostandard'
import stylistic from '@stylistic/eslint-plugin'
import noOnlyTests from 'eslint-plugin-no-only-tests'

export default [
    {
        files: ['**/*.js'],
        languageOptions: {
            globals: {
                ...globals.browser
            },
            sourceType: 'script'
        }
    },
    {
        files: ['**/*.html'],
        plugins: { html },
        settings: {
            'html/indent': 'space',
            'html/report-bad-indent': 'error'
        }
    },
    {
        ignores: [
            ...resolveIgnoresFromGitignore()
        ]
    },
    js.configs.recommended,
    // stylistic.configs['recommended-flat'],
    ...neostandard(),
    {
        plugins: {
            '@stylistic': stylistic,
            'no-only-tests': noOnlyTests
        },
        rules: {
            // built-in
            eqeqeq: 'error',
            'object-shorthand': ['error'],
            'no-unused-vars': ['error', {
                varsIgnorePattern: '^_',
                argsIgnorePattern: '^_',
                caughtErrorsIgnorePattern: '^_',
                ignoreRestSiblings: true
            }],
            'no-console': ['error', { allow: ['debug', 'info', 'warn', 'error'] }],
            quotes: ['off', 'error', 'single', { avoidEscape: true }],

            // plugin:stylistic
            '@stylistic/indent': ['warn', 4], // https://eslint.style/rules/indent#options
            '@stylistic/spaced-comment': ['error', 'always'], // https://eslint.style/rules/spaced-comment
            '@stylistic/no-multi-spaces': 'error', // https://eslint.style/rules/no-multi-spaces#no-multi-spaces
            '@stylistic/comma-dangle': ['error', 'never'], // https://eslint.style/rules/comma-dangle#comma-dangle

            // plugin:no-only-tests
            'no-only-tests/no-only-tests': 'error'
        }
    }
]
