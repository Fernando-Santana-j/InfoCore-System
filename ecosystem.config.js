module.exports = {
    apps: [
        {
            name: "infocoreSystem",
            script: "./index.js",
            watch: false,
            autorestart: true,
            exp_backoff_restart_delay: 1000,
            min_uptime: 10000,
            max_restarts: 15,
            time: true,
            env: {
                NODE_ENV: "production"
            },
        },
    ],
};
