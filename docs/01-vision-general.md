# CAMEVO — Documento de Visión del Proyecto

**Simulador de Evolución Digital bajo Cambio Climático**

| Campo | Valor |
|---|---|
| Nombre del proyecto | Camevo (**CAM**bio + **EVO**lución) |
| Autor | Ibsen Alexis Soto Artunduaga (Frezzer) |
| Documento | Visión del Proyecto (v1.1 — ver `CHANGELOG.md`) |
| Estado | Borrador inicial — Fase 0 (Documentación) |
| Repositorio propuesto | `camevo` (renombrado desde `proVida`) |

---

## 1. Resumen ejecutivo

Camevo es una plataforma web educativa que simula, mediante un modelo de vida digital inspirado en **Avida**, cómo el cambio climático altera el proceso de selección natural en poblaciones de organismos digitales autorreplicantes. El objetivo no es enseñar biología evolutiva de forma abstracta, sino **hacer visible y experimentable** un fenómeno que en la naturaleza toma generaciones y es difícil de observar: qué le pasa a una especie cuando su entorno cambia más rápido de lo que puede adaptarse.

## 2. Problema a resolver

- Existe desinformación extendida sobre el cambio climático, incluyendo negación directa de su existencia.
- La evidencia científica sobre sus efectos en biodiversidad suele presentarse en gráficos estáticos o reportes técnicos, con bajo poder persuasivo para el público general.
- No existen herramientas interactivas accesibles que permitan **experimentar en tiempo real** cómo la selección natural responde a un ambiente cambiante.

## 3. Propuesta de solución

Un simulador donde:

1. Organismos digitales (programas autorreplicantes con genoma, mutación y competencia por recursos) evolucionan dentro de una máquina virtual, siguiendo el modelo de Avida.
2. Un **módulo climático independiente** altera con el tiempo las condiciones del entorno (qué comportamientos son premiados, cuántos recursos hay disponibles, qué tan estable es el clima).
3. El usuario puede **controlar la velocidad e intensidad del cambio climático** y observar en tiempo real si la población logra adaptarse (rescate evolutivo) o colapsa (extinción).

## 4. Objetivos

### 4.1 Objetivo general
Desarrollar una plataforma web que simule visualmente el impacto del cambio climático sobre la evolución de poblaciones digitales, como herramienta de divulgación científica.

### 4.2 Objetivos específicos
- Implementar un motor de evolución digital funcional (VM, genoma, mutación, selección) inspirado en Avida.
- Diseñar un módulo climático desacoplado que module las reglas del entorno a lo largo del tiempo.
- Exponer la **tasa de cambio climático** como variable central controlable por el usuario, para demostrar el concepto de rescate evolutivo vs. extinción.
- Visualizar en tiempo real fitness, diversidad genética y parámetros climáticos.
- Servir como proyecto de aprendizaje técnico (arquitectura, backend, frontend, simulación, despliegue) documentado y construido de forma incremental.

## 5. Alcance

### 5.1 Dentro del alcance (MVP y fases iniciales)
- Motor de simulación con organismos, genoma, VM, mutación y competencia por recursos.
- Un mecanismo climático inicial: variación en las recompensas de tareas lógicas a lo largo del tiempo.
- Panel de control de escenario (velocidad de cambio, intensidad, semilla aleatoria).
- Visualización de fitness, diversidad genética y curva climática.
- Persistencia de corridas de simulación para revisión posterior.

### 5.2 Fuera del alcance
- Simulación con millones de organismos o motores 100% fieles al Avida original en C++.
- Multijugador o simulaciones colaborativas en tiempo real entre varios usuarios.
- Modelos climáticos basados en simulación física real (se usará una curva paramétrica, opcionalmente anclada a datos históricos reales de anomalía de temperatura).
- Gradiente espacial y migración de organismos hacia zonas climáticamente más favorables.
- Fragmentación de la grilla poblacional en subregiones aisladas (pérdida de hábitat).

> **Nota:** los eventos catastróficos periódicos, inicialmente excluidos, fueron reincorporados al alcance del proyecto (ver `02-requisitos.md`, RF-015) por su bajo costo de implementación y su alto valor para representar el aumento real de eventos climáticos extremos.

## 6. Audiencia objetivo

- Estudiantes y docentes de biología/ciencias ambientales buscando una herramienta interactiva de apoyo.
- Público general interesado en divulgación científica sobre cambio climático.
- Reclutadores/comunidad técnica, como pieza de portafolio que demuestra pensamiento de sistemas complejos.

## 7. Criterios de éxito

1. La selección natural emerge de forma genuina en el motor (nadie programa "quién sobrevive").
2. El usuario puede observar claramente una población colapsando cuando el clima cambia demasiado rápido, y adaptándose cuando cambia lento — sin necesidad de leer documentación adicional.
3. El proyecto queda completamente documentado (visión, requisitos, arquitectura, decisiones técnicas) como referencia reutilizable.
4. La plataforma es desplegable en la infraestructura ya usada por Frezzer (VPS Hetzner, Docker, Nginx).

## 8. Origen del nombre

**Camevo** = **Cam**bio climático + **Evo**lución. Reemplaza el nombre de trabajo anterior ("proVida") para reflejar con precisión el enfoque central del proyecto: no es solo un simulador de vida digital, es un simulador del *efecto del cambio* sobre la vida digital.

## 9. Referencias conceptuales

- Ofria, C. & Wilke, C. — Avida: A software platform for research in computational evolutionary biology.
- IPCC — Definición de cambio climático (cambios persistentes y estadísticamente significativos en media, variabilidad y frecuencia de eventos extremos).
- Conceptos de biología de la conservación: rescate evolutivo (*evolutionary rescue*) y deuda de extinción (*extinction debt*).
