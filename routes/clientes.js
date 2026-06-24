const express = require('express');
const router = express.Router();
const pool = require('../db'); 
const { verifyToken } = require('../middleware/auth'); 

const DEFAULT_CLIENTE = 'público general'; 


router.get('/', verifyToken, async (req, res) => {
      
    const esSuperAdmin = req.esSuperAdmin;
    const empresaId = req.tenantId; 
    
    let queryText = 'SELECT id, nombre FROM clientes';
    const queryParams = [];
        if (!esSuperAdmin) {
        queryText += ' WHERE empresa_id = $1';
        queryParams.push(empresaId);
    }
    
    queryText += ' ORDER BY nombre';

    try {
        const result = await pool.query(queryText, queryParams);
        
        res.status(200).json({ 
            success: true, 
            clientes: result.rows 
        });
    } catch (err) {
        console.error('Error al listar clientes:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor al obtener clientes.' 
        });
    }
});


router.post('/', verifyToken, async (req, res) => {
    if (!req.tenantId) { 
        return res.status(403).json({ success: false, message: 'Acción no permitida para SuperAdmin en esta ruta.' });
    }
    
    const { nombre } = req.body;
    const empresaId = req.tenantId; 
    
    if (!nombre || nombre.trim() === '') {
        return res.status(400).json({ success: false, message: 'El nombre del cliente es obligatorio.' });
    }

    try {
        const check = await pool.query(
            'SELECT * FROM clientes WHERE LOWER(nombre) = LOWER($1) AND empresa_id = $2',
            [nombre, empresaId]
        );

        if (check.rows.length > 0) {
            return res.status(409).json({ success: false, message: `Ya existe un cliente con el nombre "${nombre}" para su empresa.` });
        }
        
        const result = await pool.query(
            'INSERT INTO clientes (nombre, empresa_id) VALUES ($1, $2) RETURNING id, nombre',
            [nombre, empresaId]
        );
        
        res.status(201).json({ 
            success: true, 
            message: 'Cliente creado exitosamente.',
            cliente: result.rows[0]
        });
    } catch (err) {
        console.error('Error al crear cliente:', err);
        res.status(500).json({ success: false, message: 'Error interno del servidor al crear cliente.' });
    }
});
router.put('/:id', verifyToken, async (req, res) => {
    if (!req.tenantId) {
        return res.status(403).json({ success: false, message: 'Acción no permitida para SuperAdmin en esta ruta.' });
    }

    const { id } = req.params;
    const { nombre } = req.body;
    const empresaId = req.tenantId;

    if (!nombre || nombre.trim() === '') {
        return res.status(400).json({ success: false, message: 'El nombre del cliente es obligatorio.' });
    }
    
    try {
        const checkDefault = await pool.query('SELECT nombre FROM clientes WHERE id = $1 AND empresa_id = $2', [id, empresaId]);
        if (checkDefault.rows.length > 0 && checkDefault.rows[0].nombre.toLowerCase() === DEFAULT_CLIENTE) {
            return res.status(403).json({ success: false, message: 'No se puede modificar el cliente por defecto.' });
        }
        
        const result = await pool.query(
            'UPDATE clientes SET nombre = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND empresa_id = $3 RETURNING id, nombre',
            [nombre, id, empresaId]
        );
        
        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, message: 'Cliente no encontrado o no pertenece a su empresa.' });
        }
        
        res.status(200).json({ 
            success: true, 
            message: 'Cliente actualizado exitosamente.',
            cliente: result.rows[0]
        });
    } catch (err) {
        if (err.code === '23505') { 
            return res.status(409).json({ success: false, message: 'Ya existe otro cliente con ese nombre en esta empresa.' });
        }
        console.error('Error al actualizar cliente:', err);
        res.status(500).json({ success: false, message: 'Error interno del servidor al actualizar cliente.' });
    }
});


router.delete('/:id', verifyToken, async (req, res) => {
    if (!req.tenantId) {
        return res.status(403).json({ success: false, message: 'Acción no permitida para SuperAdmin en esta ruta.' });
    }

    const { id } = req.params;
    const empresaId = req.tenantId;

    try {
        const checkDefault = await pool.query('SELECT nombre FROM clientes WHERE id = $1 AND empresa_id = $2', [id, empresaId]);
        
        if (checkDefault.rowCount === 0) {
            return res.status(404).json({ success: false, message: 'Cliente no encontrado o no pertenece a su empresa.' });
        }
        if (checkDefault.rows[0].nombre.toLowerCase() === DEFAULT_CLIENTE) {
            return res.status(403).json({ success: false, message: 'No se puede eliminar el cliente por defecto ("público general").' });
        }
        
        const result = await pool.query(
            'DELETE FROM clientes WHERE id = $1 AND empresa_id = $2',
            [id, empresaId]
        );
        
        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, message: 'Cliente no encontrado o no pertenece a su empresa.' });
        }
        
        res.status(200).json({ success: true, message: 'Cliente eliminado exitosamente.' });
    } catch (err) {
        console.error('Error al eliminar cliente:', err);
        res.status(500).json({ success: false, message: 'Error interno del servidor al eliminar cliente.' });
    }
});

module.exports = router;