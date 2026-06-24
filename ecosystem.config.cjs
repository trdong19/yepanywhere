module.exports = {
  apps: [{
    name: 'yepanywhere',
    script: 'packages/server/dist/index.js',
    args: '--host 0.0.0.0',
    env: {
      NODE_ENV: 'production',
      PORT: 3500,
    },
  }, {
    name: 'yepanywhere-dev',
    script: './start-dev.sh',
    interpreter: 'none',
    env: {
      PORT: '3600',
    },
  }],
};
