# Beneficios Gigantes — versión 1

## Publicado en esta versión
- Página real beneficios.html, integrada en navegación pública, Mi Gigantes y Control Center.
- Convenio Astor + LBM: 15% en evaluaciones biomecánicas y órtesis, sin selección dentro de esas categorías. Un solo convenio; nunca un 10% separado para LBM.
- Logos originales aportados por el usuario; únicamente redimensionados para web.
- Catálogo y promociones persistentes en Supabase; se ocultan convenios fuera de fecha y publicaciones desactivadas.
- Registro real de solicitudes de hinchas y propuestas de empresas en sponsor_inquiries, project_code=BENEFICIOS. Se distinguen por interest=hincha_gigante / beneficios_empresa.
- Gestión exclusiva de directiva (superadmin/board): fichas, promociones y acuerdos de aporte privados. Bandeja de seguimiento de solicitudes.
- Aporte empresarial por acordar: no se asignó un monto a Astor ni se registró un ingreso.

## Reglas del programa
Jugador: $15.000 CLP mensuales según propuesta del club, sin otra membresía adicional. Hincha: $2.000 CLP por persona al mes, mismos descuentos al estar vigente. La modalidad hincha no sustituye obligaciones de un jugador activo. Un apoderado no está obligado a pagar una membresía para gestionar la información del hijo.

## Pendiente antes de operar pagos y credenciales
La migración de operaciones seguras no pudo aplicarse durante esta entrega. Por eso están explícitamente deshabilitados cobro, activación automática, emisión QR y canje; no se sustituyeron por códigos estáticos ni validación en el navegador.

La base contiene las tablas preparatorias benefit_supporters, benefit_supporter_payments, benefit_join_requests, benefit_company_access, benefit_tokens, benefit_redemptions y benefit_audit, sin operadores públicos para conceder beneficios. En esta versión no se escriben estos registros.

Antes de activar: revisar/aprobar reglas de elegibilidad, asignar tesorería de hinchas, vincular personas sin duplicados a sus cuentas, completar condiciones comerciales y fechas de convenio, habilitar verificación de pagos e historial de anulaciones, validar códigos temporales contra el servidor y limitar accesos de cada empresa. Probar jugadores, hinchas, apoderados, morosos, código vencido, código reutilizado y pagos anulados. No prometer que un QR por sí solo impide suplantación.

## Datos y privacidad
No se publican registros de hinchas, nombres de jugadores, deudas, movimientos financieros ni acuerdos monetarios. Los datos de contacto se solicitan con consentimiento para responder la solicitud. Las tablas usan RLS. La clave del navegador es únicamente la publishable key existente. No se modificaron roles, credenciales, cuentas ni las cuotas actuales.

## Aportes y promoción empresarial
Aportes mensuales, anuales, en productos o por campaña quedan sujetos a acuerdo; la ficha privada no crea un cargo ni acredita dinero recibido. La empresa envía propuestas y la directiva publica; no se habilitó publicación empresarial sin moderación. No se presentan cifras ficticias de clientes, ventas, canjes o ahorros.

## Archivo documental
Este archivo documenta el alcance técnico dentro del repositorio. No constituye una actualización de Google Drive, un contrato firmado ni un reglamento aprobado.
