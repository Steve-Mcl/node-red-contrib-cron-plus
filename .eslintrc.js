module.exports = {
    "plugins": [ "html" ],
    "env": {
        "browser": true,
        "commonjs": true,
        "es2021": true,
        "node": true
    },
    "extends": "eslint:recommended",
    "parserOptions": {
        "ecmaVersion": 12
    },
    "rules": {
        "space-infix-ops": [ "error", { "int32Hint": false } ],
        "object-curly-spacing": [ "error", "always" ],
        "key-spacing": ["error", { "beforeColon": false, "afterColon": true }],
        "comma-spacing": [2, { "before": false, "after": true }],
        // "array-bracket-spacing": [ "error", "always" ],
        // "computed-property-spacing": [ "error", "always" ],
        "semi": 2
    }
};
