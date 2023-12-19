module.exports = {
    "env": {
        "browser": true,
        "es2021": true
    },
    "extends": "eslint:recommended",
    "overrides": [
        {
            "env": {
                "node": true
            },
            "files": [
                ".eslintrc.{js,cjs}"
            ],
            "parserOptions": {
                "sourceType": "script"
            }
        }
    ],
    "parserOptions": {
        "ecmaVersion": "latest"
    },
    "rules": {
    },
    "globals": {
        MediaStreamTrackProcessor: true,
        MediaStreamTrackGenerator: true,
        VideoFrame: true,
        VideoEncoder: true,
        VideoDecoder: true,
        Plotly: true,
    }
}
