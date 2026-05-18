const Redis = require('ioredis');

const redis = new Redis(process.env.REDIS_URL); //mở 1 tcp connection đến Redis server

redis.on('connect', () => console.log('Redis connected'));
redis.on('error', (err) => console.error('Redis error:', err));

module.exports = redis;
