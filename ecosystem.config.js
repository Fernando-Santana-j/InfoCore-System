module.exports = {
    apps: [
        {
            name: "sdkapps",
            script: "./index.js",
            watch: false,
            env: {
                NODE_ENV: "production"
            },
        },
    ],
};
