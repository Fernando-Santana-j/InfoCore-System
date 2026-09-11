module.exports = {
    apps: [
        {
            name: "infocoreSystem",
            script: "./index.js",
            watch: false,
            env: {
                NODE_ENV: "production"
            },
        },
    ],
};
