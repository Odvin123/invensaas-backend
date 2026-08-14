const setTenant = (req, res, next) => {
    if (!req.usuario) {
        return next();
    }
    
    if (req.usuario.rol === 'super_admin') {
        req.esSuperAdmin = true;
        req.tenantId = null; 
    } else {
        req.esSuperAdmin = false;
        req.tenantId = req.usuario.empresa_id; 
        
        if (!req.tenantId) {
            return res.status(403).json({ success: false, message: 'Acceso denegado. Usuario sin empresa asignada (Tenant ID).' });
        }
    }
    
    next();
};

module.exports = { setTenant };