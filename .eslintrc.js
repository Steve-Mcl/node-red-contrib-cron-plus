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
        // "array-bracket-spacing": [ "error", "always" ],
        // "computed-property-spacing": [ "error", "always" ],
        "semi": 2
    }
};
