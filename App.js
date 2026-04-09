// --- (Cabecera y constantes igual que antes) ---
const APP_VERSION = "2026.04.025";

// ... (Resto de constantes TYPE_COLORS, TYPES_ES, etc.)

export default function App() {
  // ... (Estados y efectos igual que antes)

  const identificarPokemon = async () => {
    if (!cameraRef.current) return;
    
    // 0. DESPERTAR AUDIO Y FEEDBACK INICIAL
    try {
      Speech.stop(); // Limpiamos por si había algo sonando
      Speech.speak("Renderizando Pokémon...", { language: 'es-ES', rate: 1.0 });
    } catch(e) {}

    setLoading(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ base64: true, quality: 0.5 });
      
      let rawBase64 = photo.base64;
      // ... (Lógica de base64 para web/móvil igual)
      
      const imagePart = { inlineData: { data: rawBase64, mimeType: "image/jpeg" } };
      const prompt = "Identifica el pokemon de la imagen. Responde SOLO con el nombre en inglés en minúsculas. Si no hay ningún pokemon claro, responde 'unknown'. No añades puntuación al final.";

      let modelosAProbar = modelList.length > 0 ? [...modelList] : ["gemini-1.5-flash"];
      if (lastSuccessfulModel) {
        modelosAProbar = [lastSuccessfulModel, ...modelosAProbar.filter(m => m !== lastSuccessfulModel)];
      }

      let rawName = null;
      let modeloUsado = "";

      // 1. ANÁLISIS DE IMAGEN CON GEMINI
      for (const nombreModelo of modelosAProbar) {
        try {
          const model = genAI.getGenerativeModel({ model: nombreModelo });
          const result = await model.generateContent([prompt, imagePart]);
          rawName = result.response.text();
          modeloUsado = nombreModelo;
          setLastSuccessfulModel(nombreModelo);
          break; 
        } catch (errorModelo) { continue; }
      }

      if (!rawName) throw new Error("FALLO_MOTORES");

      const cleanName = sanitizarNombre(rawName);

      if (cleanName === 'unknown' || cleanName === '') {
        Speech.speak("Análisis fallido. No reconozco al espécimen.", { language: 'es-ES' });
        setLoading(false);
        return;
      }

      // 2. HITO: POKÉMON DETECTADO
      // Siri informa en cuanto sabe el nombre, mientras la app sigue trabajando en el fondo
      Speech.speak(`Pokémon ${cleanName} detectado con éxito. Accediendo a archivos biológicos.`, { language: 'es-ES', rate: 1.0 });

      const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${cleanName}`);
      if (!res.ok) {
        Speech.speak("Error de sincronización con la base de datos central.", { language: 'es-ES' });
        setLoading(false);
        return;
      }

      const data = await res.json();
      const speciesRes = await fetch(data.species.url);
      const speciesData = await speciesRes.json();
      
      let descripcionLimpia = "";
      const entryEs = speciesData.flavor_text_entries.find(entry => entry.language.name === 'es');
      
      if (entryEs) {
        descripcionLimpia = entryEs.flavor_text.replace(/\n|\f/g, ' ');
      } else {
        const entryEn = speciesData.flavor_text_entries.find(entry => entry.language.name === 'en');
        if (entryEn) {
          // 3. HITO: TRADUCCIÓN (Para Quaxly y cía)
          Speech.speak("Iniciando traductor universal para datos recientes.", { language: 'es-ES', rate: 1.0 });
          
          const textoIngles = entryEn.flavor_text.replace(/\n|\f/g, ' ');
          try {
            await new Promise(resolve => setTimeout(resolve, 1500)); 
            const traductor = genAI.getGenerativeModel({ model: modeloUsado || "gemini-1.5-flash" });
            const promptTrad = `Eres un traductor estricto. Traduce al español: "${textoIngles}"`;
            const resultTrad = await traductor.generateContent(promptTrad);
            descripcionLimpia = resultTrad.response.text().trim();
          } catch (errTrad) {
            descripcionLimpia = "Fallo en traducción dinámica.";
          }
        }
      }

      // 4. HITO FINAL: LECTURA DE CARACTERÍSTICAS
      const evolucionaDe = speciesData.evolves_from_species ? speciesData.evolves_from_species.name : null;
      const hpStat = data.stats.find(s => s.stat.name === 'hp');
      const hp = hpStat ? hpStat.base_stat : '??';

      const datosCompletos = { ...data, descripcion: descripcionLimpia, evoluciona_de: evolucionaDe, hp: hp };
      setPokemonData(datosCompletos);
      
      // La función hablar final leerá todo el resumen
      hablar(datosCompletos.name, datosCompletos.types[0].type.name, descripcionLimpia, evolucionaDe);
      
    } catch (e) {
      Speech.speak("Error en el sistema. Reinicie escáner.", { language: 'es-ES' });
      setLoading(false);
    } finally {
      setLoading(false);
    }
  };

  // ... (Resto de funciones reiniciar, toggle, etc. igual que antes)

  // ... (El render y los estilos se mantienen igual)
}