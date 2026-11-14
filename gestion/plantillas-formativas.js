/* Gigantes de Azapa: orientaciones internas, editables; NO equivalen a un programa certificado de World Rugby. */
(function(){
"use strict";
const aims={
 M6:{focus:"Familiarizarse con el balón y disfrutar del movimiento mediante juegos.",tech:"Explorar agarre, transporte y entrega del balón; coordinación general.",tact:"Buscar espacios libres y colaborar en juegos simples.",phys:"Equilibrio, carrera, saltos, giros y agilidad mediante juegos.",cog:"Seguir consignas sencillas y reconocer espacios.",values:"Disfrutar, compartir, escuchar y respetar turnos."},
 M8:{focus:"Desarrollar confianza con el balón y la colaboración.",tech:"Conducción, recepción y pases básicos en movimiento.",tact:"Reconocer compañero disponible y espacio libre.",phys:"Equilibrio, orientación, agilidad y coordinación.",cog:"Tomar decisiones simples y explicar qué resultó.",values:"Respeto, inclusión, participación y juego limpio."},
 M10:{focus:"Desarrollar apoyo al portador, pases y comprensión del espacio.",tech:"Pase, recepción, desplazamiento y apoyo cercano.",tact:"Identificar superioridades y buscar continuidad en juegos reducidos.",phys:"Aceleración, desaceleración, cambios de dirección y coordinación.",cog:"Resolver situaciones simples 2 contra 1.",values:"Colaboración, respeto y aceptación del error."},
 M12:{focus:"Aprender a jugar con continuidad mediante pases, apoyos y decisiones.",tech:"Pase y recepción en movimiento; apoyo al portador; manejo de balón.",tact:"Leer espacios y resolver 2 contra 1, 3 contra 2 y apoyos en juegos reducidos.",phys:"Agilidad, equilibrio, coordinación, frenadas y cambios de dirección adecuados al desarrollo.",cog:"Reconocer opciones de pase, carrera y apoyo bajo presión progresiva.",values:"Respeto, solidaridad, comunicación y disfrute del juego."},
 M14:{focus:"Consolidar continuidad de juego, toma de decisiones y cooperación defensiva.",tech:"Ejecución de pases bajo presión; apoyos y habilidades de evasión.",tact:"Principios de ataque y defensa en juegos reducidos; reorganización y comunicación.",phys:"Velocidad, coordinación, fuerza general adecuada a maduración y movilidad.",cog:"Lectura de situaciones y decisiones colectivas.",values:"Disciplina positiva, liderazgo compartido y seguridad del compañero."},
 M16:{focus:"Afianzar lectura táctica y ejecución técnica en situaciones variables.",tech:"Habilidades de manejo, continuidad y técnica individual progresiva.",tact:"Organización y transiciones de ataque/defensa; resolución bajo presión.",phys:"Fuerza general, velocidad y control de carga según maduración y capacidad.",cog:"Análisis, autonomía y liderazgo.",values:"Disciplina, respeto, responsabilidad y cohesión."},
 M18:{focus:"Consolidar fundamentos y autonomía para progresar a rugby adulto.",tech:"Precisión técnica y continuidad en contextos de juego.",tact:"Principios colectivos de ataque y defensa y adaptaciones situacionales.",phys:"Preparación física individualizada, recuperación y prevención.",cog:"Análisis de juego y decisiones autónomas.",values:"Liderazgo, respeto, autocuidado y compromiso."},
 FEM:{focus:"Promover un entorno inclusivo y desarrollar fundamentos según experiencia de las jugadoras.",tech:"Habilidades de balón y de juego adaptadas a la experiencia.",tact:"Comprensión del juego mediante progresiones de situaciones reducidas.",phys:"Preparación física graduada y adaptada a cada participante.",cog:"Confianza, toma de decisiones y comunicación.",values:"Inclusión, colaboración, respeto y pertenencia."},
 ADULTO:{focus:"Desarrollar continuidad, cooperación y condición física según objetivos del plantel.",tech:"Ejecución técnica, manejo y precisión bajo condiciones de juego.",tact:"Principios de ataque/defensa, apoyos y lectura de superioridades.",phys:"Movilidad, fuerza, acondicionamiento y recuperación según capacidad individual.",cog:"Toma de decisiones y liderazgo.",values:"Compromiso, respeto, responsabilidad y juego limpio."},
 CLASSIC:{focus:"Mantener participación, disfrute y juego seguro en rugby Classic.",tech:"Calidad de pase, recepción, apoyos y habilidades individuales.",tact:"Continuidad de juego, organización y cooperación sin sobrecarga.",phys:"Movilidad, fuerza general dosificada, recuperación y prevención de lesiones.",cog:"Lectura táctica, anticipación y comunicación.",values:"Compañerismo, inclusión, respeto y autocuidado."}
};
const titles={annual:"Plan anual",monthly:"Plan mensual",weekly:"Plan semanal",session:"Sesión de entrenamiento"};
const safe="Seguridad primero: comprobar estado del campo y materiales; hidratación, calentamiento y vuelta a la calma; adaptar esfuerzos a experiencia, maduración y necesidades individuales. Cualquier actividad de contacto debe ajustarse a las reglas de la categoría y a la normativa vigente de Chile Rugby/competencia, con entrenadores habilitados. Ante sospecha de conmoción, retirar de actividad y aplicar el protocolo correspondiente.";
function template(code,period){
 const c=aims[code]||aims.M12,per=titles[period]||titles.monthly,year=(new Date()).getFullYear();
 const periodHints={
 annual:"Línea anual orientativa: diagnóstico inicial y disfrute; fundamentos y juego reducido; progresión de decisiones y continuidad; revisión y cierre de temporada. Evaluar cada 6-8 semanas y adaptar a eventos/calendario.",
 monthly:"Progresión sugerida de 4 semanas: 1) explorar y observar; 2) resolver situaciones guiadas; 3) aumentar decisiones en juego reducido; 4) transferir al juego y revisar avances. Seleccionar 1-2 criterios principales por sesión.",
 weekly:"Distribución sugerida de dos prácticas (adaptar si hay otra frecuencia): sesión A, explorar y practicar una habilidad; sesión B, transferirla a juego reducido y evaluar. Considerar carga y partidos.",
 session:"Ejemplo adaptable de 75 minutos: 0-12 activación lúdica y movilidad; 12-27 juegos de pase y recepción; 27-42 2v1/3v2 con apoyos; 42-65 juego reducido condicionado; 65-75 recuperación, preguntas y cierre. En categorías menores, reducir duración e incrementar pausas según necesidad. Antes de la sesión decidir progresiones/regresiones, materiales y tamaño de grupos."
 };
 return {
 title:per+" base · "+code+(period==="annual"?" · "+year:""),
 summary:"Propuesta formativa orientativa Gigantes para "+code+". Meta: "+c.focus+" El entrenador adecúa contenidos, carga, tiempos y dificultades a su grupo.",
 technical_objectives:c.tech,
 tactical_objectives:c.tact,
 physical_objectives:c.phys,
 cognitive_objectives:c.cog,
 values_objectives:c.values,
 safety_notes:safe,
 session_content:periodHints[period]||periodHints.monthly,
 coach_reflection:"Registro privado al cierre: ¿qué lograron los jugadores? ¿Quiénes necesitaron una adaptación? ¿Qué cambiaré en la próxima práctica?"
 };
}
window.GIGANTES_PLAN_BASES={get:template,categories:Object.keys(aims)};
})();