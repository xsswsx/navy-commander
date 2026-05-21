const path = require('path')

module.exports = {
  apps: [{
    name: 'navy-commander',
    script: path.join(__dirname, 'node_modules', '.bin', 'tsx'),
    args: 'server/index.ts',
    env: {
      NODE_ENV: 'production',
      PORT: 3001,
    },
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
  }],
}
