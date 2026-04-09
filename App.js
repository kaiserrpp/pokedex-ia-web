import React, { useState, useRef, useEffect } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, Image, ActivityIndicator, ScrollView, Platform, Alert } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Speech from 'expo-speech';
import { GoogleGenerativeAI } from "@google/generative-ai";

// --- CONTROL DE VERSIONES ---
const APP_VERSION = "2026.04.026";

// --- CONFIGURACIÓN DE IA ---
const API_KEY = process.env.EXPO_PUBLIC_API_KEY; 
const genAI = new GoogleGenerativeAI(API_KEY);

const TYPE_COLORS = {
  fire: '#E46B43', water: '#5CB3D4', grass: '#7DB85D', electric: '#F2C347',
  ice: '#85D4E6', fighting: '#B45749', poison: '#9B5B9B', ground: '#D3A95B',
  flying: '#94A6E0', psychic: '#D2638E', bug: '#9DB33A', rock: '#AFA35C',
  ghost: '#6E5C8B', dragon: '#6E48D6', steel: '#A5A5B8', fairy: '#E094B6',
  normal: '#C2BEB2', dark: '#5E524C', unknown: '#ddd'
};

const TYPES_ES = {
  fire: 'Fuego', water: 'Agua', grass: 'Planta', electric: 'Eléctrico',
  ice: 'Hielo', fighting: 'Lucha', poison: 'Veneno', ground: 'Tierra',
  flying: 'Volador', psychic: 'Psíquico', bug: 'Bicho', rock: 'Roca',
  ghost: 'Fantasma', dragon: 'Dragón', steel: 'Acero', fairy: 'Hada',
  normal: 'Normal', dark: 'Siniestro', unknown: 'Desc.'
};

// --- DICCIONARIO DE FORMAS DE POKÉAPI ---
const sanitizarNombre = (nombreCrudo) => {
  let nombre = nombreCrudo.trim().toLowerCase();
  
  // Correcciones tipográficas
  if (nombre.includes('mr. mime') || nombre === 'mr mime') return 'mr-mime';
  if (nombre.includes('mime jr')) return 'mime-jr';
  if (nombre.includes('nidoran') && (nombre.includes('♀') || nombre.includes('f'))) return 'nidoran-f';
  if (nombre.includes('nidoran') && (nombre.includes('♂') || nombre.includes('m'))) return 'nidoran-m';
  if (nombre.includes("farfetch'd") || nombre === 'farfetchd') return 'farfetchd';
  if (nombre.includes("sirfetch'd") || nombre === 'sirfetchd') return 'sirfetchd';
  if (nombre.includes("flabébé") || nombre === 'flabebe') return 'flabebe';
  
  // Parches para Pokémon con "Formas" obligatorias en la base de datos
  if (nombre === 'keldeo' || nombre === 'kailudio') return 'keldeo-ordinary';
  if (nombre === 'deoxys') return 'deoxys-normal';
  if (nombre === 'giratina') return 'giratina-altered';
  if (nombre === 'shaymin') return 'shaymin-land';
  if (nombre === 'meloetta') return 'meloetta-aria';
  if (nombre === 'aegislash') return 'aegislash-shield';
  if (nombre === 'mimikyu') return 'mimikyu-disguised';
  
  return nombre.replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
};

export default function App() {
  const [permission, requestPermission] = useCameraPermissions();
  const [loading, setLoading] = useState(false);
  const [pokemonData, setPokemonData] = useState(null);
  
  const [debugMode, setDebugMode] = useState(false);
  const [modelList, setModelList] = useState([]);
  const [lastSuccessfulModel, setLastSuccessfulModel] = useState(null);
  const [facing, setFacing] = useState('back');
  
  const cameraRef = useRef(null);

  useEffect(() => {
    const fetchModels = async () => {
      try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`);
        const data = await response.json();
        if (data.models) {
          const utiles = data.models
            .filter(m => 
              m.supportedGenerationMethods.includes('generateContent') && 
              m.name.includes('flash') && 
              !m.name.includes('tts') && 
              !m.name.includes('text')
            )
            .map(m => m.name.replace('models/', ''));
          
          if (utiles.length > 0) setModelList(utiles);
        }
      } catch (error) {
        console.log("Error silencioso al obtener modelos:", error);
      }
    };
    fetchModels();
  }, []);

  if (!permission) return <View />;
  if (!permission.granted) {
    return (
      <View style={styles.containerCenter}>
        <Text style={{color: 'white', marginBottom: 20}}>¡Necesitamos tu cámara para la Pokédex! 📸</Text>
        <TouchableOpacity style={styles.btnBasic} onPress={requestPermission}>
          <Text style={{color: 'white', fontWeight: 'bold'}}>DAR PERMISO</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const mostrarModelosCargados = () => {
    Alert.alert(
      "Modelos en Memoria", 
      `Último exitoso: ${lastSuccessfulModel || 'Ninguno'}\n\nDisponibles:\n${modelList.join('\n')}` 
    );
  };

  const hablar = (nombre, tipoIngles, descripcion, evolucion) => {
    const tipoEspanol = TYPES_ES[tipoIngles] || tipoIngles;
    let texto = `¡He detectado a ${nombre}! Es un Pokémon de tipo ${tipoEspanol}.`;
    if (evolucion) texto += ` Evoluciona de ${evolucion}.`;
    texto += ` ${descripcion}`;
    
    try {
      Speech.speak(texto, { language: 'es-ES', rate: 0.9, pitch: 1.0 });
    } catch (e) {
      console.log("El navegador ha bloqueado el audio automático.", e);
    }
  };

  const repetirAudio = () => {
    if (pokemonData) {
      Speech.stop(); 
      hablar(pokemonData.name, pokemonData.types[0].type.name, pokemonData.descripcion, pokemonData.evoluciona_de);
    }
  };

  const identificarPokemon = async () => {
    if (!cameraRef.current) return;
    
    // 0. DESPERTAR AUDIO Y FEEDBACK INICIAL
    try {
      Speech.stop();
      Speech.speak("Analizando Pokémon...", { language: 'es-ES', rate: 1.0 });
    } catch(e) {}

    setLoading(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ base64: true, quality: 0.5 });
      
      let rawBase64 = photo.base64;
      
      if (!rawBase64 && Platform.OS === 'web') {
        const response = await fetch(photo.uri);
        const blob = await response.blob();
        rawBase64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const result = reader.result;
            resolve(result.includes(',') ? result.split(',')[1] : result);
          };
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      } else if (rawBase64 && rawBase64.startsWith('data:')) {
        rawBase64 = rawBase64.split(',')[1];
      }
      
      const imagePart = { inlineData: { data: rawBase64, mimeType: "image/jpeg" } };
      const prompt = "Identifica el pokemon de la imagen. Responde SOLO con el nombre en inglés en minúsculas. Si no hay ningún pokemon claro, responde 'unknown'. No añades puntuación al final.";

      let modelosAProbar = modelList.length > 0 ? [...modelList] : [];
      if (!modelosAProbar.includes("gemini-1.5-flash")) modelosAProbar.push("gemini-1.5-flash"); 

      if (lastSuccessfulModel) {
        modelosAProbar = [lastSuccessfulModel, ...modelosAProbar.filter(m => m !== lastSuccessfulModel)];
      }

      let rawName = null;
      let logIntentos = [];
      let modeloUsado = "";

      for (const nombreModelo of modelosAProbar) {
        try {
          const model = genAI.getGenerativeModel({ model: nombreModelo });
          const result = await model.generateContent([prompt, imagePart]);
          rawName = result.response.text();
          modeloUsado = nombreModelo;
          logIntentos.push(`✅ ${nombreModelo} (Éxito)`);
          setLastSuccessfulModel(nombreModelo);
          break; 
        } catch (errorModelo) {
          const errMsg = String(errorModelo);
          const razon = errMsg.includes('429') ? 'Cuota' : (errMsg.includes('400') ? 'Formato/Ciego' : 'Error');
          logIntentos.push(`❌ ${nombreModelo} (${razon})`);
          continue; 
        }
      }

      if (!rawName) throw new Error("ERROR_CUOTA_O_MODELOS_" + logIntentos.join(' | '));

      const cleanName = sanitizarNombre(rawName);

      if (cleanName === 'unknown' || cleanName === '') {
        Speech.speak("Análisis fallido. No reconozco al espécimen.", { language: 'es-ES' });
        alert("La IA no reconoce a ningún Pokémon en la foto.");
        setLoading(false);
        return;
      }

      // 2. HITO: POKÉMON DETECTADO
      Speech.speak(`${rawName} detectado. Accediendo a la base de datos...`, { language: 'es-ES', rate: 1.0 });

      const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${cleanName}`);
      
      if (!res.ok) {
        Speech.speak("Error de sincronización con la base de datos central.", { language: 'es-ES' });
        alert(`La IA cree que es un "${rawName.trim()}", pero no logramos encontrarlo en la base de datos oficial.`);
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
          // 3. HITO: TRADUCCIÓN SILENCIOSA
          // Hemos borrado la frase que hablaba Siri aquí para que sea más natural.
          const textoIngles = entryEn.flavor_text.replace(/\n|\f/g, ' ');
          try {
            await new Promise(resolve => setTimeout(resolve, 1500)); 
            const traductor = genAI.getGenerativeModel({ model: modeloUsado || "gemini-1.5-flash" });
            const promptTrad = `Eres un traductor estricto. Traduce la siguiente descripción de Pokémon al español. Devuelve ÚNICAMENTE el texto traducido de forma natural, sin comillas, sin saludos, sin explicaciones, y sin opciones alternativas. Texto: "${textoIngles}"`;
            const resultTrad = await traductor.generateContent(promptTrad);
            descripcionLimpia = resultTrad.response.text().trim();
          } catch (errTrad) {
            descripcionLimpia = "Fallo en el módulo de traducción. La IA está saturada.";
          }
        } else {
          descripcionLimpia = "Pokédex dañada. Datos irrecuperables.";
        }
      }

      const evolucionaDe = speciesData.evolves_from_species ? speciesData.evolves_from_species.name : null;
      const hpStat = data.stats.find(s => s.stat.name === 'hp');
      const hp = hpStat ? hpStat.base_stat : '??';

      const datosCompletos = { ...data, descripcion: descripcionLimpia, evoluciona_de: evolucionaDe, hp: hp };
      setPokemonData(datosCompletos);
      
      // 4. HITO FINAL: LECTURA DE CARACTERÍSTICAS
      hablar(datosCompletos.name, datosCompletos.types[0].type.name, descripcionLimpia, evolucionaDe);
      
    } catch (e) {
      Speech.speak("Error en el sistema. Reinicie escáner.", { language: 'es-ES' });
      alert("Error en la conexión. Revisa tus datos móviles o la cuota de API.");
    } finally {
      setLoading(false);
    }
  };

  const reiniciar = () => {
    setPokemonData(null);
    Speech.stop();
  };

  const toggleCameraFacing = () => {
    setFacing(current => (current === 'back' ? 'front' : 'back'));
  };

  const primaryType = pokemonData ? pokemonData.types[0].type.name : 'unknown';
  const dynamicColor = TYPE_COLORS[primaryType] || '#fff';
  const tipoTraducido = TYPES_ES[primaryType] || primaryType;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.lightsCol}><View style={styles.blueLight} /></View>
        <View style={styles.sideLightsCol}>
          <View style={[styles.smallLight, {backgroundColor: '#ee1515'}]} />
          <View style={[styles.smallLight, {backgroundColor: '#F8D030'}]} />
          <View style={[styles.smallLight, {backgroundColor: '#78C850'}]} />
        </View>
        <View style={styles.titleBand}><Text style={styles.titleText}>POKÉDEX IA</Text></View>
      </View>

      <View style={styles.screenFrame}>
        {loading ? (
          <View style={styles.containerCenter}><ActivityIndicator size="large" color="#333" /></View>
        ) : pokemonData ? (
          <View style={styles.tcgCardOuter}>
            <View style={[styles.tcgCardInner, { backgroundColor: dynamicColor }]}>
              <ScrollView contentContainerStyle={styles.cardContent} showsVerticalScrollIndicator={false}>
                <View style={styles.tcgHeader}>
                  <View>
                    <Text style={styles.tcgEvolvesText}>
                      {pokemonData.evoluciona_de ? `Evoluciona de ${pokemonData.evoluciona_de.toUpperCase()}` : 'Pokémon Básico'}
                    </Text>
                    <Text style={styles.tcgName}>{pokemonData.name.toUpperCase()}</Text>
                  </View>
                  <View style={styles.tcgHpBox}>
                    <Text style={styles.tcgHpText}>PS <Text style={styles.tcgHpNumber}>{pokemonData.hp}</Text></Text>
                    <View style={styles.tcgTypeIcon}><Text style={styles.tcgTypeIconText}>{tipoTraducido.substring(0,2).toUpperCase()}</Text></View>
                  </View>
                </View>

                <View style={styles.tcgImageBox}>
                  <Image source={{ uri: pokemonData.sprites.other['official-artwork'].front_default }} style={styles.tcgImage} />
                </View>

                <View style={styles.tcgStatsRibbon}>
                  <Text style={styles.tcgStatsRibbonText}>
                    Pokémon Especie. Altura: {pokemonData.height / 10} m. Peso: {pokemonData.weight / 10} kg.
                  </Text>
                </View>

                <View style={styles.tcgDescBox}>
                  <Text style={styles.tcgDescText}>{pokemonData.descripcion}</Text>
                </View>

                <View style={styles.actionRow}>
                  <TouchableOpacity style={styles.tcgAudioBtn} onPress={repetirAudio}>
                    <Text style={styles.tcgAudioBtnText}>🔊 OÍR</Text>
                  </TouchableOpacity>

                  <TouchableOpacity style={styles.tcgResetBtn} onPress={reiniciar}>
                    <Text style={styles.tcgResetBtnText}>« CÁMARA »</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </View>
          </View>
        ) : (
          <CameraView ref={cameraRef} style={styles.camera} facing={facing}>
            <TouchableOpacity style={styles.flipBtn} onPress={toggleCameraFacing}>
              <Text style={styles.flipBtnText}>📷🔄</Text>
            </TouchableOpacity>
          </CameraView>
        )}
      </View>

      {!pokemonData && !loading && (
        <View style={styles.controlsRow}>
          <TouchableOpacity 
            style={[styles.btnRedo, debugMode && {backgroundColor: '#F08030', borderColor: '#fff'}]} 
            onPress={() => setDebugMode(!debugMode)}
          >
            {debugMode && <Text style={{textAlign: 'center', marginTop: 10, fontSize: 10}}>⚙️</Text>}
          </TouchableOpacity>
          
          <TouchableOpacity style={styles.scanBtn} onPress={identificarPokemon}>
            <Text style={styles.scanBtnText}>🟢 INICIAR ANÁLISIS 🔴</Text>
          </TouchableOpacity>
          
          {debugMode ? (
             <TouchableOpacity style={[styles.btnRedo, {backgroundColor: '#333', borderColor: '#F08030'}]} onPress={mostrarModelosCargados}>
               <Text style={{textAlign: 'center', marginTop: 10, fontSize: 10}}>🔍</Text>
             </TouchableOpacity>
          ) : (
            <View style={styles.miniBtnCol}>
              <View style={styles.miniBtnBlue}></View>
              <View style={styles.miniBtnGreen}></View>
            </View>
          )}
        </View>
      )}

      <Text style={styles.versionText}>v{APP_VERSION} {debugMode && "(DEBUG ON)"}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#dc0a2d', paddingTop: Platform.OS === 'ios' ? 50 : 30, paddingHorizontal: 15, paddingBottom: 10 },
  containerCenter: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 15, backgroundColor: '#252830', padding: 10, borderRadius: 10 },
  lightsCol: { marginRight: 10 },
  blueLight: { width: 45, height: 45, borderRadius: 22.5, backgroundColor: '#2196F3', borderWidth: 4, borderColor: '#fff' },
  sideLightsCol: { marginRight: 15 },
  smallLight: { width: 10, height: 10, borderRadius: 5, marginBottom: 5, borderWidth: 1, borderColor: '#fff' },
  titleBand: { flex: 1, backgroundColor: '#ccc', padding: 5, borderRadius: 5, borderBottomWidth: 3, borderBottomColor: '#888' },
  titleText: { fontSize: 20, fontWeight: 'bold', color: '#333', textAlign: 'center', letterSpacing: 2 },
  screenFrame: { flex: 1, backgroundColor: '#fff', borderRadius: 10, borderWidth: 6, borderColor: '#444', overflow: 'hidden', justifyContent: 'center' },
  camera: { flex: 1 },
  flipBtn: { position: 'absolute', top: 15, right: 15, backgroundColor: 'rgba(0,0,0,0.6)', padding: 8, borderRadius: 25, borderWidth: 2, borderColor: '#fff' },
  flipBtnText: { fontSize: 18 },
  tcgCardOuter: { flex: 1, backgroundColor: '#F5D65A', padding: 8 }, 
  tcgCardInner: { flex: 1, borderRadius: 2, borderWidth: 1, borderColor: '#000', padding: 8 },
  tcgHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 5 },
  tcgEvolvesText: { fontSize: 9, fontStyle: 'italic', fontWeight: 'bold', color: '#333', marginBottom: -2 },
  tcgName: { fontSize: 22, fontWeight: '900', color: '#000', letterSpacing: -0.5 },
  tcgHpBox: { flexDirection: 'row', alignItems: 'center' },
  tcgHpText: { fontSize: 10, fontWeight: 'bold', color: '#B30000', marginRight: 5, marginTop: 5 },
  tcgHpNumber: { fontSize: 18, fontWeight: '900', color: '#B30000' },
  tcgTypeIcon: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#eee', borderWidth: 1, borderColor: '#666', justifyContent: 'center', alignItems: 'center', marginTop: 3 },
  tcgTypeIconText: { fontSize: 8, fontWeight: 'bold', color: '#333' },
  tcgImageBox: { width: '100%', aspectRatio: 1.1, backgroundColor: '#E2E6E6', borderWidth: 3, borderColor: '#808A96', borderRadius: 2, justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 2, height: 2 }, shadowOpacity: 0.3, shadowRadius: 2 },
  tcgImage: { width: '85%', height: '85%', resizeMode: 'contain' },
  tcgStatsRibbon: { width: '100%', backgroundColor: '#E1CA85', paddingVertical: 2, paddingHorizontal: 5, borderWidth: 1, borderColor: '#A99351', marginVertical: 6 },
  tcgStatsRibbonText: { fontSize: 8, fontStyle: 'italic', fontWeight: 'bold', textAlign: 'center', color: '#333' },
  tcgDescBox: { marginTop: 5, padding: 5 },
  tcgDescText: { fontSize: 13, lineHeight: 18, color: '#000' },
  actionRow: { flexDirection: 'row', justifyContent: 'space-around', marginTop: 20 },
  tcgAudioBtn: { backgroundColor: '#2196F3', paddingVertical: 8, paddingHorizontal: 15, borderRadius: 20, borderWidth: 2, borderColor: '#fff' },
  tcgAudioBtnText: { color: '#fff', fontSize: 11, fontWeight: 'bold' },
  tcgResetBtn: { backgroundColor: '#333', paddingVertical: 8, paddingHorizontal: 15, borderRadius: 20, borderWidth: 1, borderColor: '#F5D65A' },
  tcgResetBtnText: { color: '#F5D65A', fontSize: 11, fontWeight: 'bold' },
  btnBasic: { backgroundColor: '#333', padding: 15, borderRadius: 10 },
  controlsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 15 },
  btnRedo: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#fff', borderWidth: 2, borderColor: '#bbb', justifyContent: 'center', alignItems: 'center' },
  scanBtn: { flex: 1, backgroundColor: '#333', padding: 18, borderRadius: 10, marginHorizontal: 15, alignItems: 'center', borderWidth: 2, borderColor: '#fff' },
  scanBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 16, letterSpacing: 1 },
  miniBtnCol: { justifyContent: 'space-between', height: 40, width: 40 },
  miniBtnBlue: { width: 30, height: 18, backgroundColor: '#2196F3', borderRadius: 4, alignSelf: 'flex-end' },
  miniBtnGreen: { width: 30, height: 18, backgroundColor: '#78C850', borderRadius: 4, alignSelf: 'flex-end' },
  versionText: { color: '#fff', textAlign: 'center', fontSize: 10, opacity: 0.7, marginTop: 5 }
});