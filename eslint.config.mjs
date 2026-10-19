import typescriptEslint from "typescript-eslint";

export default [{
    files: ["**/*.ts"],
}, {
    plugins: {
        "@typescript-eslint": typescriptEslint.plugin,
    },

    languageOptions: {
        parser: typescriptEslint.parser,
        ecmaVersion: 2022,
        sourceType: "module",
    },

    rules: {
        "@typescript-eslint/naming-convention": ["warn", {
            selector: "import",
            format: ["camelCase", "PascalCase"],
        }],

        curly: "warn",
        eqeqeq: "warn",
        "no-throw-literal": "warn",
        semi: "warn",

        // DailyDev Tracker is a local-only, no-network-calls extension by design (see the
        // "Privacy & Security" section in README.md) — this is cheap insurance against that
        // invariant quietly breaking as the codebase grows.
        "no-restricted-imports": ["error", {
            paths: ["http", "https", "net", "dgram", "tls"].map((name) => ({
                name,
                message: "DailyDev Tracker must not make network calls — see the 'no network calls' invariant in README.md.",
            })),
        }],
        "no-restricted-globals": [
            "error",
            { name: "fetch", message: "DailyDev Tracker must not make network calls — see the 'no network calls' invariant in README.md." },
            { name: "XMLHttpRequest", message: "DailyDev Tracker must not make network calls — see the 'no network calls' invariant in README.md." },
        ],
    },
}];