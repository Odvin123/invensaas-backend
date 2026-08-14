require('dotenv').config();
const { Pool } = require('pg');

let poolConfig;

if (process.env.NODE_ENV === 'production') {
    console.log('🔧 Configurando para PRODUCCIÓN con IPv6 directa...');
    
    const SUPABASE_IPV6 = '2600:1f14:b9e:7b00:9201:6e2f:e61e:8ffa';
    
    poolConfig = {
        host: SUPABASE_IPV6,
        user: process.env.PGUSER || 'postgres',
        password: process.env.PGPASSWORD,
        database: process.env.PGDATABASE || 'postgres',
        port: parseInt(process.env.PGPORT) || 5432,
        ssl: {
            rejectUnauthorized: false
        },
        connectionTimeoutMillis: 10000,
        idleTimeoutMillis: 30000,
        max: 10,
    };
} else {
    console.log('🔧 Configurando para LOCAL...');
    poolConfig = {
        host: process.env.PGHOST || 'localhost',
        user: process.env.PGUSER || 'postgres',
        password: process.env.PGPASSWORD || 'Odvin123',
        database: process.env.PGDATABASE || 'InvenSaaS',
        port: process.env.PGPORT || 5432,
        ssl: false
    };
}

console.log('📋 Configuración final:', {
    host: poolConfig.host,
    user: poolConfig.user,
    database: poolConfig.database,
    port: poolConfig.port,
    ssl: !!poolConfig.ssl,
});

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