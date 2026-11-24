import { put, get } from '../storage/database.js';
const MODEL_ID='driving-style-v1';
let runtimePromise=null;
export async function getModelStatus(){return (await get('modelMetadata',MODEL_ID))||{modelId:MODEL_ID,status:'not-installed',message:'No local ONNX runtime/model bundle is installed. Rule-based analytics remain fully available.'};}
async function loadRuntime(){
  if(window.ort?.InferenceSession)return window.ort;
  if(!runtimePromise){runtimePromise=new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src=new URL('../../vendor/onnxruntime-web/ort.min.js',import.meta.url).href;
    script.onload=()=>window.ort?.InferenceSession?resolve(window.ort):reject(new Error('Local ONNX Runtime bundle did not expose window.ort'));
    script.onerror=()=>reject(new Error('Local ONNX Runtime bundle is missing'));
    document.head.appendChild(script);
  });}
  return runtimePromise;
}
export async function loadOptionalModel(path='./models/driving-style-v1.onnx'){
  try{
    const ort=await loadRuntime();
    if(ort.env?.wasm)ort.env.wasm.wasmPaths=new URL('../../vendor/onnxruntime-web/',import.meta.url).href;
    const session=await ort.InferenceSession.create(path,{executionProviders:['wasm']});
    const meta={modelId:MODEL_ID,status:'ready',path,loadedAt:Date.now(),runtime:'onnxruntime-web-wasm'}; await put('modelMetadata',meta); return {session,meta,ort};
  }catch(error){
    const meta={modelId:MODEL_ID,status:'unavailable',error:String(error),updatedAt:Date.now()}; await put('modelMetadata',meta); return {session:null,meta,ort:null};
  }
}
export async function runLocalInference(loaded, featureRow) {
  if (!loaded?.session || !loaded?.ort?.Tensor) throw new Error('A local ONNX Runtime Web bundle and validated model are required.');
  const names = ['speed_kmh','acceleration_mps2','heading_delta_deg','gps_accuracy_m','speed_limit_kmh'];
  const values = names.map(name => Number.isFinite(Number(featureRow?.[name])) ? Number(featureRow[name]) : 0);
  const inputName = loaded.session.inputNames[0];
  const tensor = new loaded.ort.Tensor('float32', Float32Array.from(values), [1, values.length]);
  return loaded.session.run({[inputName]: tensor});
}
