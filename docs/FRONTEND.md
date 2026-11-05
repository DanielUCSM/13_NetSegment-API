# Interfaz web de NetSegment

La interfaz de FLSM, VLSM y CIDR se abre en **http://127.0.0.1:8000/**. Se ejecuta con la misma aplicación FastAPI que procesa los cálculos. El frontend no requiere un servidor adicional, Node.js, compilación, fuentes externas ni CDN.

## Instalación y ejecución

Requisitos: Python 3.12, Git, navegador actualizado y conexión para descargar inicialmente las dependencias. Después de instalarlas, la interfaz y los cálculos pueden ejecutarse localmente sin conexión a Internet. JavaScript debe estar habilitado.

### Linux / Pop!_OS / macOS

```bash
git clone https://github.com/DanielUCSM/13_NetSegment-API.git
cd 13_NetSegment-API
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python -m app
```

Resultado esperado: Uvicorn inicia en http://127.0.0.1:8000. Abrir esa dirección en el navegador. Mantener la terminal abierta y finalizar con Ctrl+C.

### Windows PowerShell

```powershell
git clone https://github.com/DanielUCSM/13_NetSegment-API.git
cd 13_NetSegment-API
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m app
```

Resultado esperado: la misma interfaz en http://127.0.0.1:8000. Esta variante ejecuta el intérprete del entorno directamente, sin modificar la política de ejecución de PowerShell.

### Si ya tienes una copia del repositorio

Desde la raíz, guardar o registrar los cambios propios antes de actualizar:

```bash
git switch main
git pull --ff-only origin main
```

Activar el entorno virtual existente, instalar requirements.txt e iniciar con `python -m app`. No es necesario copiar otro ZIP sobre una carpeta sin historial Git. El archivo .env existente se conserva.

### Puerto o dirección de escucha

La configuración predeterminada utiliza HOST=127.0.0.1, PORT=8000 y LOG_LEVEL=info. Puede copiarse .env.example a .env y cambiar PORT si está ocupado. Abrir el mismo puerto en el navegador. Los cálculos usan rutas relativas al origen actual, sin una URL de backend codificada en el cliente.

## Demostración de las tres herramientas

| Herramienta | Procedimiento | Resultado esperado |
|---|---|---|
| FLSM | Cargar ejemplo y Calcular subredes | 192.168.10.0/24 se divide en cuatro /26, cada una con 62 hosts utilizables |
| VLSM | Elegir VLSM, Cargar ejemplo y Distribuir direcciones | Demandas de 500, 120, 50 y 2 hosts: bloques /23, /25, /26 y /30; 708 direcciones asignadas y 316 sin asignar |
| CIDR | Elegir CIDR, Cargar ejemplo y Agregar redes | Cuatro /24 desde 192.168.0.0 se agregan en 192.168.0.0/22; reducción de rutas de 75 % |

FLSM completa una potencia de dos: pedir tres subredes genera cuatro y la interfaz lo explica. FLSM y VLSM reservan red y broadcast y admiten como mínimo /30. CIDR acepta también /31 y /32, pero requiere cobertura exacta de una sola superred. IPv6 no forma parte del contrato actual.

Para demostrar errores, cambiar la red base VLSM a 172.16.0.0/24 manteniendo el ejemplo: el servicio rechaza la demanda por capacidad insuficiente. En CIDR, 10.0.1.0/24 y 10.0.2.0/24 se rechazan porque no forman una única superred exacta alineada.

## Resultados, exportación e historial

- La tabla muestra las redes, prefijos, máscaras, wildcard, broadcast y rangos utilizables de FLSM/VLSM. CIDR muestra las redes de origen y la cobertura exacta de la superred.
- La barra visual representa direcciones totales de los bloques, incluidas red y broadcast. En VLSM diferencia el espacio sin asignar de los hosts libres dentro de las subredes. Para bloques numerosos se agrupan partes de la visualización; la tabla y los archivos conservan todos los resultados.
- La búsqueda filtra la tabla y la paginación presenta 25 filas por página.
- CSV y JSON descargan **el resultado completo**, independientemente de la búsqueda o página actual. CSV usa UTF-8 con BOM para conservar tildes en hojas de cálculo y protege nombres que pudieran interpretarse como fórmulas.
- Imprimir abre el diálogo del navegador para imprimir o guardar como PDF. Incluye todas las filas, incluso si existe una búsqueda activa. Para miles de filas conviene utilizar CSV o JSON.
- El historial almacena hasta diez conjuntos de parámetros exitosos en localStorage, en ese navegador y origen. No es una base de datos compartida y no sincroniza equipos. Seleccionar un elemento recupera los campos; pulsar calcular vuelve a consultar la API. Borrar limpia el historial local. Si el almacenamiento está bloqueado, el cálculo sigue funcionando.
- En móvil, los botones Recientes y ? permiten abrir el historial y la guía. Las tablas amplias se desplazan horizontalmente dentro de su tarjeta.

## Estructura e integración

| Archivo | Función |
|---|---|
| frontend/index.html | Formularios, navegación, resultados y guía |
| frontend/assets/styles.css | Diseño adaptable e impresión |
| frontend/assets/app.js | Estado, llamadas HTTP, resultados, historial y exportaciones |
| frontend/assets/network.js | Validación de entradas IPv4 y generación CSV |
| app/main.py | GET / y montaje /assets, además de las rutas existentes de API |

Las solicitudes se envían a los endpoints reales de /api/v1. No hay resultados simulados en la interfaz. El backend sigue validando las solicitudes aunque el cliente ya haya verificado los campos. Los errores 400/422 se presentan en el formulario; una conexión fallida o una espera superior a 20 segundos permite reintentar conservando los datos. Cambiar de herramienta cancela la solicitud pendiente y evita mostrar una respuesta anterior en otra calculadora.

La unidad systemd existente también sirve el frontend si se despliega **la carpeta frontend junto con app**. Iniciar desde la raíz con python -m app es la opción de desarrollo y demostración. Abrir index.html directamente desde el explorador de archivos no inicia el servicio.

## Verificación automatizada

### Backend y archivos del frontend

```bash
python -m pip install -r requirements-dev.txt
python -m pytest -q
python -m pip check
```

Resultado registrado: **44 pruebas correctas**, dependencias consistentes. Incluyen las 37 pruebas originales y siete comprobaciones de integración de la interfaz, tipos MIME, rutas y ejecución desde otro directorio. Se conserva la advertencia de deprecación de Starlette/httpx del cliente de pruebas; no afecta al servidor ni a los casos verificados.

### Validaciones JavaScript

Node.js 20 o posterior es opcional para desarrollar y ejecutar pruebas, y no se necesita para abrir la aplicación:

```bash
cd frontend
npm test
```

Resultado registrado: **seis pruebas correctas**, incluidas redes límite /0 y /32, enteros estrictos, nombres duplicados y exportación CSV.

### Navegador de extremo a extremo

Desde frontend/ y con Python ya preparado en ../.venv:

```bash
npm ci
npx playwright install chromium
npm run test:e2e
```

Resultado registrado: **21 comprobaciones correctas en Chromium**, con un backend Uvicorn real iniciado y cerrado por el script. Se verifican las tres calculadoras, exportación, impresión, errores, historial, cancelación de solicitudes y vista de 390 px. No se detectaron errores JavaScript ni solicitudes a recursos externos durante los flujos. El ejecutable de Chromium y los paquetes de pruebas solo se descargan para estas pruebas opcionales.

La suite permite configurar PYTHON para otro intérprete, E2E_PORT para el puerto de prueba o BASE_URL para comprobar un servidor ya iniciado. Las capturas pueden guardarse indicando SCREENSHOT_DIR a un directorio existente.

## Incidencias frecuentes

| Problema | Acción |
|---|---|
| No module named fastapi | Usar el intérprete de .venv e instalar requirements.txt |
| La página no conecta | Comprobar que Uvicorn siga iniciado y que la URL tenga el puerto configurado |
| No se encuentra frontend/assets | Actualizar la copia completa del proyecto; no copiar únicamente app/ |
| Puerto ocupado | Editar PORT en .env e iniciar otra vez |
| Se muestra una versión anterior de la interfaz | Recargar el navegador con Ctrl+Shift+R |
| IPv4 inválida | Usar la dirección base exacta con prefijo, sin ceros iniciales en los octetos |
| CSV se ve con separadores incorrectos | Importar como UTF-8 y seleccionar coma como delimitador |

Verificación de esta incorporación: 15 de octubre de 2026. La API conserva la versión 1.0.0 y su contrato; el nuevo frontend utiliza esas mismas rutas.
