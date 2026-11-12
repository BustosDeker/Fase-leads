// Pantalla provisional para los módulos que se construyen en etapas siguientes.
import { useLocation } from 'react-router-dom';

const MODULOS: Record<string, { titulo: string; etapa: string; descripcion: string }> = {
  '/leads/ficha': { titulo: 'Ficha nominal', etapa: 'E4', descripcion: 'Buscador por nombre o identificador y los nueve bloques de la tabla 5 del informe, actualizados en vivo.' },
  '/leads/conversaciones': { titulo: 'Conversaciones', etapa: 'E5–E6', descripcion: 'Bandeja de chats, hilo en vivo, simulador de WhatsApp y toma de control humano.' },
  '/leads/pipeline': { titulo: 'Pipeline de oportunidades', etapa: 'E4', descripcion: 'Kanban por estado con filtros por asesor, canal y etapa.' },
  '/leads/cotizador': { titulo: 'Cotizador versionado', etapa: 'E4', descripcion: 'Desglose base + extras + recargos − descuentos, con bloqueo de tope y mínimo.' },
  '/leads/agenda': { titulo: 'Agenda', etapa: 'E4', descripcion: 'Citas virtuales por asesor con detección de solapamientos.' },
  '/leads/auditoria': { titulo: 'Auditoría', etapa: 'E4', descripcion: 'Controles operativos sobre el OLTP: agenda, trazabilidad, reglas económicas, escalamientos y conciliación con PAYERS.' },
  '/plataforma': { titulo: 'Agente Plataforma', etapa: 'E7', descripcion: 'Embudo transversal BUYERS → LEADS → PAYERS → CUSTOMERS → TURNED.' },
  '/fase/buyers': { titulo: 'BUYERS', etapa: 'E7', descripcion: 'Contrato de integración BUYERS → LEADS (pendiente de implementar por el equipo de BUYERS).' },
  '/fase/payers': { titulo: 'PAYERS', etapa: 'E7', descripcion: 'Contrato LEADS → PAYERS y simulador de confirmación (pendiente de implementar por el equipo de PAYERS).' },
  '/fase/customers': { titulo: 'CUSTOMERS', etapa: 'E7', descripcion: 'Pendiente de implementar por el equipo de CUSTOMERS.' },
  '/fase/turned': { titulo: 'TURNED', etapa: 'E7', descripcion: 'Pendiente de implementar por el equipo de TURNED.' },
};

export function Pendiente() {
  const { pathname } = useLocation();
  const m = MODULOS[pathname] ?? { titulo: 'Página no encontrada', etapa: '', descripcion: 'Elige una opción del menú.' };
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold tracking-tight">{m.titulo}</h1>
      <div className="tarjeta mt-4 p-6">
        {m.etapa && <span className="rounded-full border border-linea-fuerte px-2.5 py-0.5 text-xs font-medium text-tinta-2">En construcción · etapa {m.etapa}</span>}
        <p className="mt-3 text-sm text-tinta-2">{m.descripcion}</p>
      </div>
    </div>
  );
}
