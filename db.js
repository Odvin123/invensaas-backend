require('dotenv').config();
const { Pool } = require('pg');

let poolConfig;

if (process.env.NODE_ENV === 'production') {
    poolConfig = {
        connectionString: process.env.DATABASE_URL,
        ssl: {
            rejectUnauthorized: false 
        },
        family: 4,  
        connectionTimeoutMillis: 10000,
        idleTimeoutMillis: 30000,
        max: 10,
    };
} else {
    
    poolConfig = {
        host: process.env.PGHOST || 'localhost',
        user: process.env.PGUSER || 'postgres',
        password: process.env.PGPASSWORD || 'Odvin123',
        database: process.env.PGDATABASE || 'InvenSaaS',
        port: process.env.PGPORT || 5432,
        ssl: false
    };
}

const pool = new Pool(poolConfig);

pool.on('connect', () => {
    console.log('✅ Conectado a la base de datos');
});

pool.on('error', (err) => {
    console.error('❌ Error en la conexión:', err);
});

const query = (text, params) => pool.query(text, params);
const getClient = () => pool.connect();

module.exports = {
    query,
    getClient,
};