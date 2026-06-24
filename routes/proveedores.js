const express = require('express');
const router = express.Router(); 
const db = require('../db'); 
const { verifyToken } = require('../middleware/auth');

router.get('/', verifyToken, async (req, res) => {
    if (req.usuario.rol !== 'administrador' && req.usuario.rol !== 'super_admin') {
        return res.status(403).json({ success: false, message: 'Acción no permitida para este rol.' });
    }
    
    const esSuperAdmin = req.esSuperAdmin;
    const empresaId = req.tenantId; 

    let queryText = 'SELECT id, nombre, telefono, correo_contacto FROM proveedores';
    const queryParams = [];

    if (!esSuperAdmin) {
        queryText += ' WHERE empresa_id = $1';
        queryParams.push(empresaId);
    }
    
    queryText += ' ORDER BY nombre ASC';
    
    try {

        const result = await db.query(queryText, queryParams);

        return res.status(200).json({ 
            success: true, 
            proveedores: result.rows 
        });

    } catch (error) {
        console.error('Error al obtener proveedores:', error);
        res.status(500).json({ success: false, message: 'Error interno al obtener proveedores.' });
    }
});

// Crear Nuevo Proveedor
router.post('/', verifyToken, async (req, res) => {
        if (!req.tenantId) {
        return res.status(403).json({ success: false, message: 'Acción no permitida para SuperAdmin en esta ruta.' });
    }
    
    const { nombre, telefono, correo_contacto } = req.body;
    const empresaId = req.tenantId; 
    
    if (!nombre) {
        return res.status(400).json({ success: false, message: 'El nombre del proveedor es obligatorio.' });
    }
    
    try {

        const result = await db.query(
            `INSERT INTO proveedores (empresa_id, nombre, telefono, correo_contacto) 
             VALUES ($1, $2, $3, $4) RETURNING id, nombre`,
            [empresaId, nombre, telefono || null, correo_contacto || null]
        );

        return res.status(201).json({
            success: true,
            message: `Proveedor ${nombre} creado exitosamente.`,
            proveedor: result.rows[0]
        });

    } catch (error) {
        if (error.code === '23505') { 
            return res.status(409).json({ success: false, message: `El proveedor llamado "${nombre}" ya existe en su catálogo.` });
        }
        console.error('Error al crear proveedor:', error);
        res.status(500).json({ success: false, message: 'Error interno al crear proveedor.' });
    }
});

// Editar Proveedor
router.put('/:id', verifyToken, async (req, res) => {
    if (!req.tenantId) {
        return res.status(403).json({ success: false, message: 'Acción no permitida para SuperAdmin en esta ruta.' });
    }

    const proveedorId = req.params.id;
    const { nombre, telefono, correo_contacto } = req.body;
    const empresaId = req.tenantId; 

    if (!nombre) {
        return res.status(400).json({ success: false, message: 'El nombre del proveedor es obligatorio.' });
    }

    try {

        const updateResult = await db.query(
            `UPDATE proveedores
             SET nombre = $1, telefono = $2, correo_contacto = $3, fecha_registro = CURRENT_TIMESTAMP
             WHERE id = $4 AND empresa_id = $5
             RETURNING id, nombre`,
            [nombre, telefono || null, correo_contacto || null, proveedorId, empresaId]
        );

        if (updateResult.rowCount === 0) {
            return res.status(404).json({ success: false, message: 'Proveedor no encontrado o no pertenece a esta empresa.' });
        }

        return res.status(200).json({
            success: true,
            message: `Proveedor ${nombre} actualizado exitosamente.`,
            proveedor: updateResult.rows[0]
        });

    } catch (error) {
        if (error.code === '23505') {
            return res.status(409).json({ success: false, message: `El proveedor llamado "${nombre}" ya existe en su catálogo.` });
        }
        console.error('Error al editar proveedor:', error);
        res.status(500).json({ success: false, message: 'Error interno al editar proveedor.' });
    }
});

// Eliminar Proveedor
router.delete('/:id', verifyToken, async (req, res) => {
    if (!req.tenantId) {
        return res.status(403).json({ success: false, message: 'Acción no permitida para SuperAdmin en esta ruta.' });
    }

    const proveedorId = req.params.id;
    const empresaId = req.tenantId; 

    try {


        const deleteResult = await db.query(
            'DELETE FROM proveedores WHERE id = $1 AND empresa_id = $2 RETURNING id',
            [proveedorId, empresaId]
        );

        if (deleteResult.rowCount === 0) {
            return res.status(404).json({ success: false, message: 'Proveedor no encontrado o no pertenece a esta empresa.' });
        }

        return res.status(200).json({
            success: true,
            message: 'Proveedor eliminado exitosamente.'
        });

    } catch (error) {
        console.error('Error al eliminar proveedor:', error);
        res.status(500).json({ success: false, message: 'Error interno al eliminar proveedor.' });
    }
});

module.exports = router;