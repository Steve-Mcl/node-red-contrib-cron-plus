module.exports = {
    env: {
        browser: true,
        commonjs: true,
        es2021: true,
        jquery: true
    },
    extends: [
        'standard'
    ],
    parserOptions: {
        ecmaVersion: 12
    },
    rules: {
        indent: ['error', 4]
    }
}
