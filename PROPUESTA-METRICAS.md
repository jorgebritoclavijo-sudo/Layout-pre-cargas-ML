# Propuesta separada: datos para métricas operativas

Esta propuesta no agrega cálculos a la aplicación. Los objetivos y cierres existentes se conservan como captura manual; no se derivan resultados sin datos de operación suficientes.

## Datos que conviene definir

- **Producción por estación y periodo:** paquetes terminados, fecha, turno, isla o etiquetadora, hora inicial y final del periodo.
- **Tiempo de trabajo medible:** minutos productivos, pausas planeadas y minutos detenidos con una causa. La operación debe decidir qué tiempos entran en el denominador.
- **Objetivo comparable:** paquetes por hora o paquetes por periodo, estación a la que aplica y vigencia del objetivo.
- **Contenedores:** contenedores esperados, cerrados completos, incompletos y faltantes, relacionados con estación y periodo.
- **Calidad del dato:** quién capturó el dato y si fue confirmado; evitar mezclar valores planeados con producción real.

## Fórmulas candidatas sujetas a validación

1. **Paquetes por hora:** paquetes terminados durante el periodo ÷ horas productivas de ese mismo periodo. Requiere acordar cómo registrar pausas y paros.
2. **Cumplimiento de objetivo:** paquetes reales ÷ objetivo de paquetes para el mismo periodo. Si el objetivo está expresado por hora, primero se debe acordar si se ajusta por horas productivas.
3. **Cierre de contenedores:** contenedores completos ÷ contenedores esperados × 100. No calcular si el total esperado no está capturado o es cero.

Antes de implementar cualquiera de estas fórmulas, el equipo debe confirmar definiciones, unidades, tratamiento de pausas y la fuente de producción real. En particular, el campo actual `# Contenedores` no distingue por sí solo cuántos están completos ni cuántos se esperaban.

## Almacenamiento

En esta fase los registros siguen guardándose en el navegador mediante `localStorage`. No hay sincronización entre dispositivos ni usuarios; cada dispositivo debe exportar e importar su propio respaldo.

