require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    host: process.env.PGHOST,
    user: process.env.PGUSER,
    database: process.env.PGDATABASE,
    password: process.env.PGPASSWORD,
    port: process.env.PGPORT,
});

const query = (text, params) => pool.query(text, params);

const getClient = () => pool.connect(); 

module.exports = {
    query,
    getClient, 
};