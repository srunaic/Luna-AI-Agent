import { useEffect, useMemo, useRef, useState } from 'react';
import './LunaDisplay.css';

// NOTE: These deps are added in webview-ui/package.json
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  VRM,
  VRMLoaderPlugin,
  VRMUtils,
  VRMHumanBoneName,
  VRMExpressionPresetName
} from '@pixiv/three-vrm';

type GestureName = 'idle' | 'wave' | 'nod';
type CameraPreset = 'front' | 'threeQuarter' | 'fullBody';
type SpeakGestureMode = 'auto' | 'nod' | 'wave' | 'off';
type EmotionBase = 'none' | 'happy' | 'relaxed' | 'sad' | 'angry';
type AutoEmotionMode = 'keywords' | 'keywords+punct';

type BehaviorPresetId = 'neutral' | 'cheerful' | 'calm' | 'cool' | 'energetic' | 'shy';

const BEHAVIOR_PRESETS: Array<{
  id: BehaviorPresetId;
  name: string;
  speakGesture: SpeakGestureMode;
  gestureIntensity: number;
  idleMotion: number;
  mouthStrength: number;
  emotionBase: EmotionBase;
  emotionStrength: number;
}> = [
  { id: 'neutral', name: 'Neutral', speakGesture: 'auto', gestureIntensity: 0.9, idleMotion: 0.7, mouthStrength: 0.7, emotionBase: 'none', emotionStrength: 0.0 },
  { id: 'cheerful', name: 'Cheerful', speakGesture: 'nod', gestureIntensity: 1.1, idleMotion: 0.9, mouthStrength: 0.85, emotionBase: 'happy', emotionStrength: 0.35 },
  { id: 'calm', name: 'Calm', speakGesture: 'nod', gestureIntensity: 0.7, idleMotion: 0.5, mouthStrength: 0.55, emotionBase: 'relaxed', emotionStrength: 0.35 },
  { id: 'cool', name: 'Cool', speakGesture: 'off', gestureIntensity: 0.45, idleMotion: 0.25, mouthStrength: 0.55, emotionBase: 'none', emotionStrength: 0.0 },
  { id: 'energetic', name: 'Energetic', speakGesture: 'wave', gestureIntensity: 1.25, idleMotion: 1.1, mouthStrength: 0.95, emotionBase: 'happy', emotionStrength: 0.25 },
  { id: 'shy', name: 'Shy', speakGesture: 'nod', gestureIntensity: 0.6, idleMotion: 0.45, mouthStrength: 0.5, emotionBase: 'sad', emotionStrength: 0.18 }
];

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function pickAutoEmotionFromText(text: string, mode: AutoEmotionMode): EmotionBase | null {
  const t = (text || '').toLowerCase();
  if (!t.trim()) return null;

  const containsAny = (arr: string[]) => arr.some((k) => t.includes(k));

  // Very lightweight heuristic (extendable)
  const angry = ['angry', 'rage', 'wtf', 'error', 'bug', 'annoy', 'mad'];
  const sad = ['sad', 'depress', 'sorry', 'apologize', 'tired', 'down'];
  const happy = ['happy', 'great', 'awesome', 'nice', 'thanks', 'lol'];
  const relaxed = ['relax', 'calm', 'ok', 'okay', 'no problem'];

  if (containsAny(angry)) return 'angry';
  if (containsAny(sad)) return 'sad';
  if (containsAny(happy)) return 'happy';
  if (containsAny(relaxed)) return 'relaxed';

  if (mode === 'keywords+punct') {
    const ex = (text.match(/!/g) || []).length;
    const q = (text.match(/\?/g) || []).length;
    const dots = (text.match(/\.{3}/g) || []).length;
    // crude bias: many ! => energetic/happy, many ? => none, dots => sad/relaxed
    if (ex >= 2) return 'happy';
    if (dots >= 1) return 'sad';
    if (q >= 2) return 'none';
  }

  return null;
}

type KeywordRules = {
  angry: string[];
  sad: string[];
  happy: string[];
  relaxed: string[];
};

const DEFAULT_KEYWORDS: KeywordRules = {
  angry: ['angry', 'rage', 'wtf', 'error', 'bug'],
  sad: ['sad', 'depress', 'sorry', 'tired'],
  happy: ['happy', 'great', 'awesome', 'nice', 'thanks'],
  relaxed: ['relax', 'calm', 'ok', 'okay', 'no problem']
};

function normalizeKeywordList(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const cleaned = list
    .map((x) => String(x ?? '').trim().toLowerCase())
    .filter((x) => x.length > 0);
  // de-dup
  return Array.from(new Set(cleaned));
}

function mergeKeywords(defaults: string[], custom: string[]): string[] {
  return Array.from(new Set([...defaults, ...custom].map((s) => s.trim().toLowerCase()).filter(Boolean)));
}

function pickAutoEmotionFromTextWithRules(text: string, mode: AutoEmotionMode, rules: KeywordRules): EmotionBase | null {
  const t = (text || '').toLowerCase();
  if (!t.trim()) return null;

  const containsAny = (arr: string[]) => arr.some((k) => k && t.includes(k));

  // Priority: angry > sad > happy > relaxed
  if (containsAny(rules.angry)) return 'angry';
  if (containsAny(rules.sad)) return 'sad';
  if (containsAny(rules.happy)) return 'happy';
  if (containsAny(rules.relaxed)) return 'relaxed';

  // fallback punctuation heuristics
  return pickAutoEmotionFromText(text, mode);
}

const LUNA_DISPLAY_CURRENT_PROFILE_KEY = 'luna.lunaDisplay.currentProfile.v1';
const LUNA_DISPLAY_PROFILES_KEY = 'luna.lunaDisplay.profiles.v1';
const LUNA_DISPLAY_PROFILE_SETTINGS_KEY_PREFIX = 'luna.lunaDisplay.profile.settings.v1.'; // + profileId
const LUNA_DISPLAY_PROFILE_AVATAR_META_KEY_PREFIX = 'luna.lunaDisplay.profile.avatarMeta.v1.'; // + profileId
const LUNA_DISPLAY_IDB_DB = 'luna.lunaDisplay';
const LUNA_DISPLAY_IDB_STORE = 'files';
const LUNA_DISPLAY_IDB_KEY_PREFIX = 'vrm:'; // + profileId

const EXPRESSION_PRESETS: VRMExpressionPresetName[] = [
  VRMExpressionPresetName.Aa,
  VRMExpressionPresetName.Ih,
  VRMExpressionPresetName.Ou,
  VRMExpressionPresetName.Ee,
  VRMExpressionPresetName.Oh,
  VRMExpressionPresetName.Blink,
  VRMExpressionPresetName.BlinkLeft,
  VRMExpressionPresetName.BlinkRight,
  VRMExpressionPresetName.Happy,
  VRMExpressionPresetName.Angry,
  VRMExpressionPresetName.Sad,
  VRMExpressionPresetName.Relaxed,
  VRMExpressionPresetName.Surprised
];

const POSE_BONES: { label: string; bone: VRMHumanBoneName }[] = [
  { label: 'Neck', bone: VRMHumanBoneName.Neck },
  { label: 'Head', bone: VRMHumanBoneName.Head },
  { label: 'LeftUpperArm', bone: VRMHumanBoneName.LeftUpperArm },
  { label: 'LeftLowerArm', bone: VRMHumanBoneName.LeftLowerArm },
  { label: 'RightUpperArm', bone: VRMHumanBoneName.RightUpperArm },
  { label: 'RightLowerArm', bone: VRMHumanBoneName.RightLowerArm }
];

export interface LunaDisplayProps {
  open: boolean;
  onClose: () => void;
  speakText?: string;
}

export function LunaDisplay({ open, onClose, speakText }: LunaDisplayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [status, setStatus] = useState<string>('No avatar loaded');
  const [hasAvatar, setHasAvatar] = useState(false);
  const [autoIdle, setAutoIdle] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [autoRotate, setAutoRotate] = useState(false);
  const [lightIntensity, setLightIntensity] = useState(1.2);
  const [hemiIntensity, setHemiIntensity] = useState(0.9);
  const [avatarScale, setAvatarScale] = useState(1.0);
  const [avatarY, setAvatarY] = useState(0.0);
  const [cameraPreset, setCameraPreset] = useState<CameraPreset>('threeQuarter');
  const [expressionValues, setExpressionValues] = useState<Record<string, number>>(() => ({}));
  const [poseBone, setPoseBone] = useState<VRMHumanBoneName>(VRMHumanBoneName.Neck);
  const [poseRx, setPoseRx] = useState(0);
  const [poseRy, setPoseRy] = useState(0);
  const [poseRz, setPoseRz] = useState(0);
  const [rememberAvatar, setRememberAvatar] = useState(true);
  const [restoredOnce, setRestoredOnce] = useState(false);
  const [profiles, setProfiles] = useState<Array<{ id: string; name: string; createdAt: number; updatedAt: number }>>([]);
  const [currentProfileId, setCurrentProfileId] = useState<string>('default');
  const [behaviorPreset, setBehaviorPreset] = useState<BehaviorPresetId>('neutral');
  const [speakGestureMode, setSpeakGestureMode] = useState<SpeakGestureMode>('auto');
  const [gestureIntensity, setGestureIntensity] = useState(0.9);
  const [idleMotionStrength, setIdleMotionStrength] = useState(0.7);
  const [mouthStrength, setMouthStrength] = useState(0.7);
  const [emotionBase, setEmotionBase] = useState<EmotionBase>('none');
  const [emotionStrength, setEmotionStrength] = useState(0.0);
  const [autoEmotionEnabled, setAutoEmotionEnabled] = useState(true);
  const [autoEmotionMode, setAutoEmotionMode] = useState<AutoEmotionMode>('keywords+punct');
  const [autoEmotionHoldMs, setAutoEmotionHoldMs] = useState(3500);
  const [autoEmotionCooldownMs, setAutoEmotionCooldownMs] = useState(2500);
  const [autoEmotionMinChars, setAutoEmotionMinChars] = useState(12);
  const [customKeywords, setCustomKeywords] = useState<KeywordRules>(() => ({
    angry: [],
    sad: [],
    happy: [],
    relaxed: []
  }));
  const [keywordDrafts, setKeywordDrafts] = useState<Record<keyof KeywordRules, string>>({
    angry: '',
    sad: '',
    happy: '',
    relaxed: ''
  });
  const [autoEmotionTestText, setAutoEmotionTestText] = useState('');

  const [emotionOverride, setEmotionOverride] = useState<EmotionBase | null>(null);
  const [emotionOverrideUntil, setEmotionOverrideUntil] = useState<number>(0);
  const lastAutoEmotionAtRef = useRef<number>(0);

  const openIdb = (): Promise<IDBDatabase> =>
    new Promise((resolve, reject) => {
      const req = indexedDB.open(LUNA_DISPLAY_IDB_DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(LUNA_DISPLAY_IDB_STORE)) {
          db.createObjectStore(LUNA_DISPLAY_IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

  const idbPut = async (key: string, value: any) => {
    const db = await openIdb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(LUNA_DISPLAY_IDB_STORE, 'readwrite');
      const store = tx.objectStore(LUNA_DISPLAY_IDB_STORE);
      store.put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  };

  const idbGet = async <T,>(key: string): Promise<T | undefined> => {
    const db = await openIdb();
    const out = await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(LUNA_DISPLAY_IDB_STORE, 'readonly');
      const store = tx.objectStore(LUNA_DISPLAY_IDB_STORE);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return out;
  };

  const idbDel = async (key: string) => {
    const db = await openIdb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(LUNA_DISPLAY_IDB_STORE, 'readwrite');
      const store = tx.objectStore(LUNA_DISPLAY_IDB_STORE);
      store.delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  };

  const loadSettingsFromStorage = () => {
    try {
      const raw = localStorage.getItem(`${LUNA_DISPLAY_PROFILE_SETTINGS_KEY_PREFIX}${currentProfileId}`);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (typeof s?.autoIdle === 'boolean') setAutoIdle(s.autoIdle);
      if (typeof s?.showGrid === 'boolean') setShowGrid(s.showGrid);
      if (typeof s?.autoRotate === 'boolean') setAutoRotate(s.autoRotate);
      if (typeof s?.lightIntensity === 'number') setLightIntensity(s.lightIntensity);
      if (typeof s?.hemiIntensity === 'number') setHemiIntensity(s.hemiIntensity);
      if (typeof s?.avatarScale === 'number') setAvatarScale(s.avatarScale);
      if (typeof s?.avatarY === 'number') setAvatarY(s.avatarY);
      if (typeof s?.cameraPreset === 'string') setCameraPreset(s.cameraPreset as CameraPreset);
      if (s?.expressionValues && typeof s.expressionValues === 'object') setExpressionValues(s.expressionValues);
      if (typeof s?.poseBone === 'string') setPoseBone(s.poseBone as VRMHumanBoneName);
      if (typeof s?.poseRx === 'number') setPoseRx(s.poseRx);
      if (typeof s?.poseRy === 'number') setPoseRy(s.poseRy);
      if (typeof s?.poseRz === 'number') setPoseRz(s.poseRz);
      if (typeof s?.rememberAvatar === 'boolean') setRememberAvatar(s.rememberAvatar);
      if (typeof s?.behaviorPreset === 'string') setBehaviorPreset(s.behaviorPreset as BehaviorPresetId);
      if (typeof s?.speakGestureMode === 'string') setSpeakGestureMode(s.speakGestureMode as SpeakGestureMode);
      if (typeof s?.gestureIntensity === 'number') setGestureIntensity(s.gestureIntensity);
      if (typeof s?.idleMotionStrength === 'number') setIdleMotionStrength(s.idleMotionStrength);
      if (typeof s?.mouthStrength === 'number') setMouthStrength(s.mouthStrength);
      if (typeof s?.emotionBase === 'string') setEmotionBase(s.emotionBase as EmotionBase);
      if (typeof s?.emotionStrength === 'number') setEmotionStrength(s.emotionStrength);
      if (typeof s?.autoEmotionEnabled === 'boolean') setAutoEmotionEnabled(s.autoEmotionEnabled);
      if (typeof s?.autoEmotionMode === 'string') setAutoEmotionMode(s.autoEmotionMode as AutoEmotionMode);
      if (typeof s?.autoEmotionHoldMs === 'number') setAutoEmotionHoldMs(s.autoEmotionHoldMs);
      if (typeof s?.autoEmotionCooldownMs === 'number') setAutoEmotionCooldownMs(s.autoEmotionCooldownMs);
      if (typeof s?.autoEmotionMinChars === 'number') setAutoEmotionMinChars(s.autoEmotionMinChars);
      if (s?.customKeywords && typeof s.customKeywords === 'object') {
        setCustomKeywords({
          angry: normalizeKeywordList((s.customKeywords as any).angry),
          sad: normalizeKeywordList((s.customKeywords as any).sad),
          happy: normalizeKeywordList((s.customKeywords as any).happy),
          relaxed: normalizeKeywordList((s.customKeywords as any).relaxed)
        });
      }
    } catch (_) {
      // ignore
    }
  };

  const saveSettingsToStorage = () => {
    try {
      const payload = {
        v: 1,
        autoIdle,
        showGrid,
        autoRotate,
        lightIntensity,
        hemiIntensity,
        avatarScale,
        avatarY,
        cameraPreset,
        expressionValues,
        poseBone,
        poseRx,
        poseRy,
        poseRz,
        rememberAvatar,
        behaviorPreset,
        speakGestureMode,
        gestureIntensity,
        idleMotionStrength,
        mouthStrength,
        emotionBase,
        emotionStrength,
        autoEmotionEnabled,
        autoEmotionMode,
        autoEmotionHoldMs,
        autoEmotionCooldownMs,
        autoEmotionMinChars,
        customKeywords
      };
      localStorage.setItem(`${LUNA_DISPLAY_PROFILE_SETTINGS_KEY_PREFIX}${currentProfileId}`, JSON.stringify(payload));
    } catch (_) {
      // ignore
    }
  };

  const saveAvatarMeta = (meta: any) => {
    try {
      localStorage.setItem(`${LUNA_DISPLAY_PROFILE_AVATAR_META_KEY_PREFIX}${currentProfileId}`, JSON.stringify(meta));
    } catch (_) { }
  };

  const loadAvatarMeta = (): any | null => {
    try {
      const raw = localStorage.getItem(`${LUNA_DISPLAY_PROFILE_AVATAR_META_KEY_PREFIX}${currentProfileId}`);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  };

  const saveProfilesToStorage = (next: Array<{ id: string; name: string; createdAt: number; updatedAt: number }>) => {
    try {
      localStorage.setItem(LUNA_DISPLAY_PROFILES_KEY, JSON.stringify({ v: 1, profiles: next }));
    } catch (_) { }
  };

  const loadProfilesFromStorage = (): Array<{ id: string; name: string; createdAt: number; updatedAt: number }> => {
    try {
      const raw = localStorage.getItem(LUNA_DISPLAY_PROFILES_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.profiles)) return parsed.profiles;
      return [];
    } catch (_) {
      return [];
    }
  };

  const saveCurrentProfileToStorage = (id: string) => {
    try {
      localStorage.setItem(LUNA_DISPLAY_CURRENT_PROFILE_KEY, JSON.stringify({ v: 1, id }));
    } catch (_) { }
  };

  const loadCurrentProfileFromStorage = (): string | null => {
    try {
      const raw = localStorage.getItem(LUNA_DISPLAY_CURRENT_PROFILE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (typeof parsed?.id === 'string') return parsed.id;
      return null;
    } catch (_) {
      return null;
    }
  };

  const ensureDefaultProfile = () => {
    const now = Date.now();
    let next = loadProfilesFromStorage();
    if (!next.find((p) => p.id === 'default')) {
      next = [{ id: 'default', name: 'Luna1', createdAt: now, updatedAt: now }, ...next];
      saveProfilesToStorage(next);
    }
    setProfiles(next);
    const cur = loadCurrentProfileFromStorage();
    if (cur && next.some((p) => p.id === cur)) {
      setCurrentProfileId(cur);
    } else {
      setCurrentProfileId('default');
    }
  };

  const touchProfileUpdatedAt = (id: string) => {
    setProfiles((prev) => {
      const now = Date.now();
      const next = prev.map((p) => (p.id === id ? { ...p, updatedAt: now } : p));
      saveProfilesToStorage(next);
      return next;
    });
  };

  const refs = useRef<{
    renderer?: THREE.WebGLRenderer;
    scene?: THREE.Scene;
    camera?: THREE.PerspectiveCamera;
    controls?: OrbitControls;
    clock?: THREE.Clock;
    raf?: number;
    vrm?: VRM;
    gesture?: GestureName;
    gestureT?: number;
    disposed?: boolean;
    grid?: THREE.GridHelper;
    hemi?: THREE.HemisphereLight;
    dir?: THREE.DirectionalLight;
    lastLoadedFile?: File | Blob;
  }>({});

  const loader = useMemo(() => {
    const l = new GLTFLoader();
    l.register((parser: any) => new VRMLoaderPlugin(parser));
    return l;
  }, []);

  const teardown = () => {
    const r = refs.current;
    r.disposed = true;
    if (r.raf) cancelAnimationFrame(r.raf);
    r.raf = undefined;
    if (r.controls) {
      r.controls.dispose();
      r.controls = undefined;
    }
    if (r.renderer) {
      r.renderer.dispose();
      r.renderer = undefined;
    }
    if (r.scene) r.scene = undefined;
    if (r.camera) r.camera = undefined;
    if (r.vrm) {
      try {
        r.vrm.scene?.traverse((obj: any) => {
          if (obj?.isMesh) {
            obj.geometry?.dispose?.();
            const mat = obj.material;
            if (Array.isArray(mat)) mat.forEach((m) => m?.dispose?.());
            else mat?.dispose?.();
          }
        });
      } catch (_) { }
      r.vrm = undefined;
    }
    setHasAvatar(false);
  };

  const resize = () => {
    const r = refs.current;
    const canvas = canvasRef.current;
    if (!canvas || !r.renderer || !r.camera) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    r.renderer.setSize(w, h, false);
    r.camera.aspect = w / Math.max(1, h);
    r.camera.updateProjectionMatrix();
  };

  const setGesture = (g: GestureName) => {
    refs.current.gesture = g;
    refs.current.gestureT = 0;
  };

  const applyGesture = (delta: number) => {
    const r = refs.current;
    const vrm = r.vrm;
    if (!vrm) return;
    if (!r.gesture) r.gesture = 'idle';
    r.gestureT = (r.gestureT ?? 0) + delta;

    // Basic humanoid bone manipulation (intentionally simple; extend later)
    const rightUpperArm = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.RightUpperArm);
    const rightLowerArm = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.RightLowerArm);
    const neck = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Neck);

    if (r.gesture === 'idle') {
      // small breathing-like motion
      const t = r.gestureT;
      if (neck) {
        neck.rotation.x = Math.sin(t * 0.8) * 0.05 * idleMotionStrength;
        neck.rotation.y = Math.sin(t * 0.6) * 0.06 * idleMotionStrength;
      }
      if (rightUpperArm && autoIdle) rightUpperArm.rotation.z = Math.sin(t * 0.9) * 0.03 * idleMotionStrength;
      return;
    }

    if (r.gesture === 'wave') {
      const t = r.gestureT;
      const gi = gestureIntensity;
      if (rightUpperArm) rightUpperArm.rotation.z = -0.9 * gi;
      if (rightLowerArm) rightLowerArm.rotation.z = (-0.7 + Math.sin(t * 10) * 0.25) * gi;
      // auto-finish
      if (t > 1.6) setGesture('idle');
      return;
    }

    if (r.gesture === 'nod') {
      const t = r.gestureT;
      const gi = gestureIntensity;
      if (neck) neck.rotation.x = Math.sin(t * 10) * 0.18 * gi;
      if (t > 0.8) setGesture('idle');
    }
  };

  const applyEmotionBase = () => {
    const vrm = refs.current.vrm;
    if (!vrm) return;
    const mgr: any = (vrm as any).expressionManager;
    if (!mgr?.setValue) return;

    // Clear known emotion presets first (keep user sliders separately)
    mgr.setValue(VRMExpressionPresetName.Happy, 0);
    mgr.setValue(VRMExpressionPresetName.Relaxed, 0);
    mgr.setValue(VRMExpressionPresetName.Sad, 0);
    mgr.setValue(VRMExpressionPresetName.Angry, 0);

    const now = Date.now();
    const base: EmotionBase =
      emotionOverride && now < emotionOverrideUntil ? emotionOverride : emotionBase;

    const v = clamp(emotionStrength, 0, 1);
    if (base === 'happy') mgr.setValue(VRMExpressionPresetName.Happy, v);
    if (base === 'relaxed') mgr.setValue(VRMExpressionPresetName.Relaxed, v);
    if (base === 'sad') mgr.setValue(VRMExpressionPresetName.Sad, v);
    if (base === 'angry') mgr.setValue(VRMExpressionPresetName.Angry, v);
  };

  const speak = (text: string) => {
    const r = refs.current;
    const vrm = r.vrm;
    if (!vrm) return;

    // Visual-only ?쐓peaking?? short mouth-open + gesture hint.
    const mgr: any = (vrm as any).expressionManager;
    if (mgr?.setValue) {
      const s = Math.max(0, Math.min(1, mouthStrength));
      mgr.setValue(VRMExpressionPresetName.Aa, 1.0 * s);
      window.setTimeout(() => mgr.setValue(VRMExpressionPresetName.Aa, 0.0), 220);
      window.setTimeout(() => mgr.setValue(VRMExpressionPresetName.Aa, 0.6 * s), 420);
      window.setTimeout(() => mgr.setValue(VRMExpressionPresetName.Aa, 0.0), 650);
    }

    // Light ?쐔hinking??gesture
    if (text && text.length > 0) {
      const mode = speakGestureMode;
      if (mode === 'off') return;
      if (mode === 'nod') setGesture('nod');
      else if (mode === 'wave') setGesture('wave');
      else {
        // auto: short answers nod, longer answers wave occasionally
        if (text.length < 60) setGesture('nod');
        else setGesture(Math.random() < 0.25 ? 'wave' : 'nod');
      }
    }

    // Auto Emotion rule engine (per profile)
    if (autoEmotionEnabled && text && text.trim().length >= autoEmotionMinChars) {
      const now = Date.now();
      if (now - lastAutoEmotionAtRef.current >= autoEmotionCooldownMs) {
        const rules: KeywordRules = {
          angry: mergeKeywords(DEFAULT_KEYWORDS.angry, customKeywords.angry),
          sad: mergeKeywords(DEFAULT_KEYWORDS.sad, customKeywords.sad),
          happy: mergeKeywords(DEFAULT_KEYWORDS.happy, customKeywords.happy),
          relaxed: mergeKeywords(DEFAULT_KEYWORDS.relaxed, customKeywords.relaxed)
        };
        const picked = pickAutoEmotionFromTextWithRules(text, autoEmotionMode, rules);
        if (picked && picked !== 'none') {
          lastAutoEmotionAtRef.current = now;
          setEmotionOverride(picked);
          setEmotionOverrideUntil(now + autoEmotionHoldMs);
          // apply immediately
          window.setTimeout(() => applyEmotionBase(), 0);
          // and schedule cleanup
          window.setTimeout(() => {
            // only clear if expired
            if (Date.now() >= (now + autoEmotionHoldMs)) {
              setEmotionOverride(null);
              setEmotionOverrideUntil(0);
            }
          }, autoEmotionHoldMs + 50);
        }
      }
    }
  };

  const initIfNeeded = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const r = refs.current;
    if (r.renderer) return;

    r.disposed = false;
    r.clock = new THREE.Clock();

    const scene = new THREE.Scene();
    scene.background = null;

    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    camera.position.set(0, 1.35, 2.6);

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 1.2, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 0.9;
    controls.maxDistance = 6;

    const hemi = new THREE.HemisphereLight(0xffffff, 0x222222, 0.9);
    scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 1.2);
    dir.position.set(2, 3.5, 2);
    scene.add(dir);

    const grid = new THREE.GridHelper(10, 10, 0x2a2d2e, 0x2a2d2e);
    (grid.material as any).opacity = 0.35;
    (grid.material as any).transparent = true;
    grid.position.y = 0;
    scene.add(grid);

    r.scene = scene;
    r.camera = camera;
    r.renderer = renderer;
    r.controls = controls;
    r.grid = grid;
    r.hemi = hemi;
    r.dir = dir;

    const loop = () => {
      if (r.disposed) return;
      const dt = r.clock?.getDelta() ?? 0;
      if (r.controls) r.controls.update();
      if (r.vrm) {
        // Apply transform controls
        r.vrm.scene.scale.setScalar(avatarScale);
        r.vrm.scene.position.y = avatarY;

        // Optional slow turntable
        if (autoRotate) r.vrm.scene.rotation.y += dt * 0.4;

        applyGesture(dt);
        r.vrm.update(dt);
      }
      renderer.render(scene, camera);
      r.raf = requestAnimationFrame(loop);
    };

    resize();
    setGesture('idle');
    loop();
  };

  const loadVrmFile = async (file: File) => {
    try {
      setStatus(`Loading: ${file.name}`);
      initIfNeeded();
      refs.current.lastLoadedFile = file;

      const url = URL.createObjectURL(file);
      const gltf = await loader.loadAsync(url);
      URL.revokeObjectURL(url);

      // Basic cleanup / optimize (safe for most VRM)
      VRMUtils.removeUnnecessaryVertices(gltf.scene);
      VRMUtils.removeUnnecessaryJoints(gltf.scene);

      const vrm = (gltf.userData as any).vrm as VRM | undefined;
      if (!vrm) throw new Error('Not a VRM file (VRM metadata missing).');

      // Remove old avatar
      if (refs.current.vrm && refs.current.scene) {
        refs.current.scene.remove(refs.current.vrm.scene);
      }

      refs.current.vrm = vrm;
      refs.current.scene?.add(vrm.scene);

      // Place on ground
      vrm.scene.position.set(0, 0, 0);
      vrm.scene.scale.setScalar(avatarScale);

      // Reset expressions map (keep user values if desired, but safer to reset now)
      setExpressionValues({});

      setHasAvatar(true);
      setStatus(`Loaded: ${file.name}`);
      setGesture('idle');

      // Persist avatar blob for next restart (best-effort)
      if (rememberAvatar) {
        try {
          await idbPut(`${LUNA_DISPLAY_IDB_KEY_PREFIX}${currentProfileId}`, file);
          saveAvatarMeta({ name: file.name, size: file.size, type: file.type || 'model/vrm', savedAt: Date.now() });
          touchProfileUpdatedAt(currentProfileId);
          setStatus(`Loaded + saved: ${file.name}`);
        } catch (e) {
          console.warn('Failed to save VRM to IndexedDB:', e);
          setStatus(`Loaded (save failed): ${file.name}`);
        }
      }
    } catch (e) {
      console.error(e);
      setStatus(`Load failed: ${e instanceof Error ? e.message : String(e)}`);
      setHasAvatar(false);
    }
  };

  const restoreSavedAvatarIfAny = async () => {
    if (!rememberAvatar) return;
    if (hasAvatar) return;
    try {
      const saved = await idbGet<File | Blob>(`${LUNA_DISPLAY_IDB_KEY_PREFIX}${currentProfileId}`);
      if (!saved) return;
      const meta = loadAvatarMeta();
      const name = meta?.name || 'saved.vrm';
      setStatus(`Restoring saved avatar: ${name}`);

      const blob = saved instanceof Blob ? saved : new Blob([saved], { type: (saved as any).type || 'model/vrm' });
      refs.current.lastLoadedFile = blob;
      const url = URL.createObjectURL(blob);
      const gltf = await loader.loadAsync(url);
      URL.revokeObjectURL(url);

      VRMUtils.removeUnnecessaryVertices(gltf.scene);
      VRMUtils.removeUnnecessaryJoints(gltf.scene);

      const vrm = (gltf.userData as any).vrm as VRM | undefined;
      if (!vrm) throw new Error('Saved file is not a valid VRM.');

      if (refs.current.vrm && refs.current.scene) refs.current.scene.remove(refs.current.vrm.scene);
      refs.current.vrm = vrm;
      refs.current.scene?.add(vrm.scene);
      vrm.scene.position.set(0, 0, 0);
      vrm.scene.scale.setScalar(avatarScale);

      setHasAvatar(true);
      setStatus(`Restored: ${name}`);
      setGesture('idle');
    } catch (e) {
      console.warn(e);
      setStatus(`Restore failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const forgetSavedAvatar = async () => {
    try {
      await idbDel(`${LUNA_DISPLAY_IDB_KEY_PREFIX}${currentProfileId}`);
    } catch (_) { }
    try {
      localStorage.removeItem(`${LUNA_DISPLAY_PROFILE_AVATAR_META_KEY_PREFIX}${currentProfileId}`);
    } catch (_) { }
    setStatus('Saved avatar cleared');
  };

  const saveCurrentAvatarNow = async () => {
    if (!rememberAvatar) {
      setStatus('Remember avatar is OFF');
      return;
    }
    const blob = refs.current.lastLoadedFile;
    if (!blob) {
      setStatus('No loaded VRM file to save yet');
      return;
    }
    try {
      const meta = loadAvatarMeta();
      const name = meta?.name || (blob instanceof File ? blob.name : 'saved.vrm');
      await idbPut(`${LUNA_DISPLAY_IDB_KEY_PREFIX}${currentProfileId}`, blob);
      saveAvatarMeta({
        name,
        size: (blob as any).size,
        type: (blob as any).type || 'model/vrm',
        savedAt: Date.now()
      });
      touchProfileUpdatedAt(currentProfileId);
      setStatus(`Saved: ${name}`);
    } catch (e) {
      setStatus(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const resetAllSettings = () => {
    setAutoIdle(true);
    setShowGrid(true);
    setAutoRotate(false);
    setLightIntensity(1.2);
    setHemiIntensity(0.9);
    setAvatarScale(1.0);
    setAvatarY(0.0);
    setCameraPreset('threeQuarter');
    setExpressionValues({});
    setPoseBone(VRMHumanBoneName.Neck);
    setPoseRx(0);
    setPoseRy(0);
    setPoseRz(0);
  };

  useEffect(() => {
    if (!open) {
      teardown();
      return;
    }
    initIfNeeded();
    resize();
    const onResize = () => resize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // One-time restore when panel opens
    if (restoredOnce) return;
    setRestoredOnce(true);
    ensureDefaultProfile();
    loadSettingsFromStorage();
    void restoreSavedAvatarIfAny();
  }, [open, restoredOnce]);

  useEffect(() => {
    if (!open) return;
    saveSettingsToStorage();
  }, [
    open,
    autoIdle,
    showGrid,
    autoRotate,
    lightIntensity,
    hemiIntensity,
    avatarScale,
    avatarY,
    cameraPreset,
    expressionValues,
    poseBone,
    poseRx,
    poseRy,
    poseRz,
    rememberAvatar
  ]);

  const createProfile = async () => {
    const name = window.prompt('?꾨줈???대쫫???낅젰?섏꽭??(?? Luna2)');
    if (!name) return;
    const id = `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();
    const next = [...profiles, { id, name: name.trim(), createdAt: now, updatedAt: now }];
    setProfiles(next);
    saveProfilesToStorage(next);
    // switch to new profile
    setCurrentProfileId(id);
    saveCurrentProfileToStorage(id);
    setStatus(`Switched to profile: ${name.trim()}`);
    // reset settings for new profile
    resetAllSettings();
    // clear loaded avatar state (but keep viewer alive)
    setHasAvatar(false);
    refs.current.vrm && refs.current.scene?.remove(refs.current.vrm.scene);
    refs.current.vrm = undefined;
  };

  const renameProfile = () => {
    const cur = profiles.find((p) => p.id === currentProfileId);
    const nextName = window.prompt('???꾨줈???대쫫', cur?.name || '');
    if (!nextName) return;
    const now = Date.now();
    const next = profiles.map((p) => (p.id === currentProfileId ? { ...p, name: nextName.trim(), updatedAt: now } : p));
    setProfiles(next);
    saveProfilesToStorage(next);
    setStatus(`Renamed profile to: ${nextName.trim()}`);
  };

  const deleteProfile = async () => {
    if (currentProfileId === 'default') {
      setStatus('Default profile cannot be deleted');
      return;
    }
    const cur = profiles.find((p) => p.id === currentProfileId);
    const ok = window.confirm(`?꾨줈?꾩쓣 ??젣?좉퉴?? (${cur?.name || currentProfileId})`);
    if (!ok) return;

    // delete stored avatar + meta + settings
    try { await idbDel(`${LUNA_DISPLAY_IDB_KEY_PREFIX}${currentProfileId}`); } catch (_) { }
    try { localStorage.removeItem(`${LUNA_DISPLAY_PROFILE_AVATAR_META_KEY_PREFIX}${currentProfileId}`); } catch (_) { }
    try { localStorage.removeItem(`${LUNA_DISPLAY_PROFILE_SETTINGS_KEY_PREFIX}${currentProfileId}`); } catch (_) { }

    const next = profiles.filter((p) => p.id !== currentProfileId);
    setProfiles(next);
    saveProfilesToStorage(next);

    // switch to default
    setCurrentProfileId('default');
    saveCurrentProfileToStorage('default');
    setStatus('Profile deleted. Switched to default.');

    // reload default settings/avatar
    setHasAvatar(false);
    refs.current.vrm && refs.current.scene?.remove(refs.current.vrm.scene);
    refs.current.vrm = undefined;
    loadSettingsFromStorage();
    void restoreSavedAvatarIfAny();
  };

  const switchProfile = (id: string) => {
    if (id === currentProfileId) return;
    // save current first
    saveSettingsToStorage();
    setCurrentProfileId(id);
    saveCurrentProfileToStorage(id);
    setStatus(`Switched profile`);
    // clear current avatar and restore from selected profile
    setHasAvatar(false);
    refs.current.vrm && refs.current.scene?.remove(refs.current.vrm.scene);
    refs.current.vrm = undefined;
    // load per-profile settings and avatar
    window.setTimeout(() => {
      loadSettingsFromStorage();
      void restoreSavedAvatarIfAny();
    }, 0);
  };

  useEffect(() => {
    const r = refs.current;
    if (r.grid) r.grid.visible = showGrid;
  }, [showGrid]);

  useEffect(() => {
    const r = refs.current;
    if (r.dir) r.dir.intensity = lightIntensity;
    if (r.hemi) r.hemi.intensity = hemiIntensity;
  }, [lightIntensity, hemiIntensity]);

  useEffect(() => {
    const r = refs.current;
    const camera = r.camera;
    const controls = r.controls;
    if (!camera || !controls) return;

    if (cameraPreset === 'front') {
      camera.position.set(0, 1.35, 2.6);
      controls.target.set(0, 1.2, 0);
    } else if (cameraPreset === 'threeQuarter') {
      camera.position.set(1.2, 1.35, 2.4);
      controls.target.set(0, 1.15, 0);
    } else if (cameraPreset === 'fullBody') {
      camera.position.set(1.8, 1.2, 4.2);
      controls.target.set(0, 1.0, 0);
    }
    controls.update();
  }, [cameraPreset]);

  useEffect(() => {
    const vrm = refs.current.vrm;
    if (!vrm) return;
    const mgr: any = (vrm as any).expressionManager;
    if (!mgr?.setValue) return;

    for (const [k, v] of Object.entries(expressionValues)) {
      try {
        mgr.setValue(k, v);
      } catch (_) { }
    }
    applyEmotionBase();
  }, [expressionValues]);

  useEffect(() => {
    if (!open) return;
    if (!hasAvatar) return;
    applyEmotionBase();
  }, [open, hasAvatar, emotionBase, emotionStrength]);

  useEffect(() => {
    if (!open) return;
    if (!hasAvatar) return;
    applyEmotionBase();
  }, [open, hasAvatar, emotionOverride, emotionOverrideUntil]);

  useEffect(() => {
    if (!open) return;
    const p = BEHAVIOR_PRESETS.find((x) => x.id === behaviorPreset);
    if (!p) return;
    setSpeakGestureMode(p.speakGesture);
    setGestureIntensity(p.gestureIntensity);
    setIdleMotionStrength(p.idleMotion);
    setMouthStrength(p.mouthStrength);
    setEmotionBase(p.emotionBase);
    setEmotionStrength(p.emotionStrength);
  }, [behaviorPreset]);

  useEffect(() => {
    const vrm = refs.current.vrm;
    if (!vrm) return;
    const node = vrm.humanoid?.getNormalizedBoneNode(poseBone);
    if (!node) return;
    node.rotation.x = poseRx;
    node.rotation.y = poseRy;
    node.rotation.z = poseRz;
  }, [poseBone, poseRx, poseRy, poseRz]);

  useEffect(() => {
    if (!open) return;
    if (!speakText) return;
    if (!hasAvatar) return;
    speak(speakText);
  }, [open, speakText, hasAvatar]);

  if (!open) return null;

  return (
    <div className="luna-display-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="luna-display-panel" role="dialog" aria-modal="true" aria-label="Luna Display">
        <div className="luna-display-header">
          <div className="luna-display-title">Luna Display (VRM)</div>
          <button className="luna-display-close" onClick={onClose}>Close</button>
        </div>

        <div className="luna-display-body">
          <div className="luna-display-controls">
            <input
              ref={fileInputRef}
              type="file"
              accept=".vrm,model/gltf-binary,model/gltf+json"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void loadVrmFile(file);
                e.currentTarget.value = '';
              }}
            />
            <button className="luna-btn primary" onClick={() => fileInputRef.current?.click()}>
              Load VRM
            </button>
            <button className="luna-btn" onClick={() => setGesture('wave')} disabled={!hasAvatar}>
              Wave
            </button>
            <button className="luna-btn" onClick={() => setGesture('nod')} disabled={!hasAvatar}>
              Nod
            </button>
            <button className="luna-btn" onClick={() => setAutoIdle((v) => !v)} disabled={!hasAvatar}>
              Auto idle: {autoIdle ? 'ON' : 'OFF'}
            </button>
          </div>

          <div className="luna-display-hint">
            - Load VRM: VRoid/VRM ?뚯씪???좏깮?댁꽌 罹먮┃?곕? ?꾩썎?덈떎.<br />
            - ?꾨옒?먯꽌 ?꾩튂/?ㅼ???移대찓??議곕챸/?쒖젙/?ъ쫰瑜??명똿?????덉뒿?덈떎.
          </div>

          <div className="luna-section">
            <div className="luna-section-title">Persistence</div>
            <div className="luna-inline">
              <select
                className="luna-select"
                value={currentProfileId}
                onChange={(e) => switchProfile(e.target.value)}
                title="?꾨줈???щ’)???좏깮?섎㈃ ??λ맂 VRM/?명똿??遺덈윭?듬땲??"
              >
                {profiles.length === 0 ? (
                  <option value="default">Luna1</option>
                ) : (
                  profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))
                )}
              </select>
              <button className="luna-btn" onClick={() => void createProfile()}>
                New profile
              </button>
              <button className="luna-btn" onClick={renameProfile}>
                Rename
              </button>
              <button className="luna-btn" onClick={() => void deleteProfile()}>
                Delete
              </button>
              <button className="luna-btn" onClick={() => setRememberAvatar((v) => !v)}>
                Remember avatar: {rememberAvatar ? 'ON' : 'OFF'}
              </button>
              <button
                className="luna-btn"
                onClick={() => void saveCurrentAvatarNow()}
                disabled={!hasAvatar}
                title="?꾩옱 VRM ?뚯씪(Blob)??IndexedDB????ν빀?덈떎."
              >
                Save now
              </button>
              <button className="luna-btn" onClick={() => void forgetSavedAvatar()}>
                Forget saved avatar
              </button>
              <button className="luna-btn" onClick={resetAllSettings}>
                Reset settings
              </button>
            </div>
            <div className="luna-display-hint">
              - ?명똿媛믪? ?먮룞 ??λ맗?덈떎(localStorage).<br />
              - VRM ?뚯씪? Remember ON????濡쒕뱶 ???먮룞?쇰줈 IndexedDB????λ맗?덈떎. (?⑸웾/?뺤콉???곕씪 ?ㅽ뙣?????덉쓬)
            </div>
          </div>

          <div className="luna-section">
            <div className="luna-section-title">Behavior Style (per profile)</div>
            <div className="luna-inline">
              <select
                className="luna-select"
                value={behaviorPreset}
                onChange={(e) => setBehaviorPreset(e.target.value as BehaviorPresetId)}
                title="?꾨줈?꾨쭏??湲곕낯 ?깃꺽/?쒖뒪泥??ㅽ??쇱쓣 ??ν빀?덈떎."
              >
                {BEHAVIOR_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <select
                className="luna-select"
                value={speakGestureMode}
                onChange={(e) => setSpeakGestureMode(e.target.value as SpeakGestureMode)}
                title="Speak gesture mode"
              >
                <option value="auto">Speak gesture: Auto</option>
                <option value="nod">Speak gesture: Nod</option>
                <option value="wave">Speak gesture: Wave</option>
                <option value="off">Speak gesture: Off</option>
              </select>
              <select
                className="luna-select"
                value={emotionBase}
                onChange={(e) => setEmotionBase(e.target.value as EmotionBase)}
                title="湲곕낯 媛먯젙(?곸떆 ?쒖젙)"
              >
                <option value="none">Emotion: None</option>
                <option value="happy">Emotion: Happy</option>
                <option value="relaxed">Emotion: Relaxed</option>
                <option value="sad">Emotion: Sad</option>
                <option value="angry">Emotion: Angry</option>
              </select>
            </div>
            <div className="luna-row">
              <label>Gesture intensity</label>
              <div className="luna-inline">
                <input type="range" min={0.2} max={1.6} step={0.01} value={gestureIntensity} onChange={(e) => setGestureIntensity(Number(e.target.value))} />
                <span className="luna-kv">{gestureIntensity.toFixed(2)}</span>
              </div>
            </div>
            <div className="luna-row">
              <label>Idle motion</label>
              <div className="luna-inline">
                <input type="range" min={0} max={1.6} step={0.01} value={idleMotionStrength} onChange={(e) => setIdleMotionStrength(Number(e.target.value))} />
                <span className="luna-kv">{idleMotionStrength.toFixed(2)}</span>
              </div>
            </div>
            <div className="luna-row">
              <label>Mouth strength</label>
              <div className="luna-inline">
                <input type="range" min={0} max={1} step={0.01} value={mouthStrength} onChange={(e) => setMouthStrength(Number(e.target.value))} />
                <span className="luna-kv">{mouthStrength.toFixed(2)}</span>
              </div>
            </div>
            <div className="luna-row">
              <label>Emotion strength</label>
              <div className="luna-inline">
                <input type="range" min={0} max={1} step={0.01} value={emotionStrength} onChange={(e) => setEmotionStrength(Number(e.target.value))} />
                <span className="luna-kv">{emotionStrength.toFixed(2)}</span>
              </div>
            </div>
            <div className="luna-display-hint">
              - ??媛믩뱾? **?꾨줈?꾨퀎濡????*?⑸땲??<br />
              - Luna媛 ?듬????꾨즺????assistant ?묐떟) ?꾨줈???ㅽ??쇱뿉 ?곕씪 ?쒖뒪泥??낅え??湲곕낯 媛먯젙???щ씪吏묐땲??
            </div>
          </div>

          <div className="luna-section">
            <div className="luna-section-title">Auto Emotion (rule engine)</div>
            <div className="luna-inline">
              <button className="luna-btn" onClick={() => setAutoEmotionEnabled((v) => !v)}>
                Auto emotion: {autoEmotionEnabled ? 'ON' : 'OFF'}
              </button>
              <select className="luna-select" value={autoEmotionMode} onChange={(e) => setAutoEmotionMode(e.target.value as AutoEmotionMode)}>
                <option value="keywords">Mode: Keywords</option>
                <option value="keywords+punct">Mode: Keywords + Punct</option>
              </select>
              <button
                className="luna-btn"
                onClick={() => {
                  setEmotionOverride(null);
                  setEmotionOverrideUntil(0);
                  lastAutoEmotionAtRef.current = 0;
                  setStatus('Auto emotion reset');
                }}
              >
                Reset auto emotion
              </button>
              <button
                className="luna-btn"
                onClick={() => {
                  setCustomKeywords({
                    angry: [],
                    sad: [],
                    happy: [],
                    relaxed: []
                  });
                  setStatus('Custom keywords cleared (defaults remain)');
                }}
                title="?ъ슜???ㅼ썙?쒕? 紐⑤몢 鍮꾩썎?덈떎. (湲곕낯 ?ㅼ썙?쒕뒗 怨꾩냽 ?곸슜)"
              >
                Clear custom keywords
              </button>
            </div>
            <div className="luna-row">
              <label>Min chars</label>
              <div className="luna-inline">
                <input type="range" min={0} max={80} step={1} value={autoEmotionMinChars} onChange={(e) => setAutoEmotionMinChars(Number(e.target.value))} />
                <span className="luna-kv">{autoEmotionMinChars}</span>
              </div>
            </div>
            <div className="luna-row">
              <label>Hold (ms)</label>
              <div className="luna-inline">
                <input type="range" min={500} max={12000} step={100} value={autoEmotionHoldMs} onChange={(e) => setAutoEmotionHoldMs(Number(e.target.value))} />
                <span className="luna-kv">{autoEmotionHoldMs}</span>
              </div>
            </div>
            <div className="luna-row">
              <label>Cooldown (ms)</label>
              <div className="luna-inline">
                <input type="range" min={0} max={15000} step={100} value={autoEmotionCooldownMs} onChange={(e) => setAutoEmotionCooldownMs(Number(e.target.value))} />
                <span className="luna-kv">{autoEmotionCooldownMs}</span>
              </div>
            </div>
            <div className="luna-inline">
              <span className="luna-kv">
                Current override: {emotionOverride ? `${emotionOverride} (${Math.max(0, emotionOverrideUntil - Date.now())}ms)` : 'none'}
              </span>
            </div>

            <div className="luna-row">
              <label>Test</label>
              <div className="luna-inline">
                <input
                  className="luna-select"
                  style={{ flex: 1, minWidth: 220 }}
                  value={autoEmotionTestText}
                  onChange={(e) => setAutoEmotionTestText(e.target.value)}
                  placeholder="?ш린??臾몄옣???ｊ퀬 Test瑜??꾨Ⅴ?몄슂"
                />
                <button
                  className="luna-btn"
                  onClick={() => {
                    const rules = {
                      angry: mergeKeywords(DEFAULT_KEYWORDS.angry, customKeywords.angry),
                      sad: mergeKeywords(DEFAULT_KEYWORDS.sad, customKeywords.sad),
                      happy: mergeKeywords(DEFAULT_KEYWORDS.happy, customKeywords.happy),
                      relaxed: mergeKeywords(DEFAULT_KEYWORDS.relaxed, customKeywords.relaxed)
                    };
                    const picked = pickAutoEmotionFromTextWithRules(autoEmotionTestText, autoEmotionMode, rules);
                    setStatus(`Auto emotion test -> ${picked || 'none'}`);
                    if (picked && picked !== 'none') {
                      const now = Date.now();
                      setEmotionOverride(picked);
                      setEmotionOverrideUntil(now + autoEmotionHoldMs);
                      window.setTimeout(() => applyEmotionBase(), 0);
                    }
                  }}
                >
                  Test
                </button>
              </div>
            </div>

            {(['angry', 'sad', 'happy', 'relaxed'] as Array<keyof KeywordRules>).map((key) => (
              <div key={key} className="luna-row">
                <label>{key} keywords</label>
                <div className="luna-inline">
                  <input
                    className="luna-select"
                    style={{ flex: 1, minWidth: 180 }}
                    value={keywordDrafts[key] || ''}
                    onChange={(e) => setKeywordDrafts((prev) => ({ ...prev, [key]: e.target.value }))}
                    placeholder="異붽????ㅼ썙??(?? 吏쒖쬆)"
                  />
                  <button
                    className="luna-btn"
                    onClick={() => {
                      const raw = (keywordDrafts[key] || '').trim();
                      if (!raw) return;
                      const k = raw.toLowerCase();
                      setCustomKeywords((prev) => ({ ...prev, [key]: Array.from(new Set([...(prev[key] || []), k])) }));
                      setKeywordDrafts((prev) => ({ ...prev, [key]: '' }));
                      setStatus(`Added keyword to ${key}: ${k}`);
                    }}
                  >
                    Add
                  </button>
                  <div className="luna-inline" style={{ gap: 6 }}>
                    {(customKeywords[key] || []).map((kw) => (
                      <button
                        key={kw}
                        className="luna-btn"
                        style={{ padding: '4px 8px', fontSize: 11 }}
                        title="Click to remove"
                        onClick={() => {
                          setCustomKeywords((prev) => ({ ...prev, [key]: (prev[key] || []).filter((x) => x !== kw) }));
                          setStatus(`Removed keyword from ${key}: ${kw}`);
                        }}
                      >
                        {kw} 횞
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ))}
            <div className="luna-display-hint">
              - ?꾨줈?꾨퀎濡???λ맗?덈떎.<br />
              - speakText(猷⑤굹???듬?)?먯꽌 ?ㅼ썙???먮굦???깆쓣 媛먯???emotion???좉퉸 諛붽씔 ?? ?먮룞?쇰줈 踰좎씠??媛먯젙?쇰줈 ?뚯븘?듬땲??
            </div>
          </div>

          <div className="luna-section">
            <div className="luna-section-title">Scene / Camera</div>
            <div className="luna-inline">
              <button className="luna-btn" onClick={() => setShowGrid((v) => !v)}>
                Grid: {showGrid ? 'ON' : 'OFF'}
              </button>
              <button className="luna-btn" onClick={() => setAutoRotate((v) => !v)} disabled={!hasAvatar}>
                Auto rotate: {autoRotate ? 'ON' : 'OFF'}
              </button>
              <select className="luna-select" value={cameraPreset} onChange={(e) => setCameraPreset(e.target.value as CameraPreset)}>
                <option value="front">Camera: Front</option>
                <option value="threeQuarter">Camera: 3/4</option>
                <option value="fullBody">Camera: Full body</option>
              </select>
            </div>
            <div className="luna-row">
              <label>Directional light</label>
              <div className="luna-inline">
                <input type="range" min={0} max={3} step={0.05} value={lightIntensity} onChange={(e) => setLightIntensity(Number(e.target.value))} />
                <span className="luna-kv">{lightIntensity.toFixed(2)}</span>
              </div>
            </div>
            <div className="luna-row">
              <label>Hemisphere light</label>
              <div className="luna-inline">
                <input type="range" min={0} max={3} step={0.05} value={hemiIntensity} onChange={(e) => setHemiIntensity(Number(e.target.value))} />
                <span className="luna-kv">{hemiIntensity.toFixed(2)}</span>
              </div>
            </div>
          </div>

          <div className="luna-section">
            <div className="luna-section-title">Avatar Transform</div>
            <div className="luna-row">
              <label>Scale</label>
              <div className="luna-inline">
                <input type="range" min={0.2} max={2.5} step={0.01} value={avatarScale} onChange={(e) => setAvatarScale(Number(e.target.value))} />
                <span className="luna-kv">{avatarScale.toFixed(2)}</span>
              </div>
            </div>
            <div className="luna-row">
              <label>Height (Y)</label>
              <div className="luna-inline">
                <input type="range" min={-1} max={1.5} step={0.01} value={avatarY} onChange={(e) => setAvatarY(Number(e.target.value))} />
                <span className="luna-kv">{avatarY.toFixed(2)}</span>
              </div>
            </div>
            <div className="luna-inline">
              <button className="luna-btn" onClick={() => { setAvatarScale(1.0); setAvatarY(0.0); }} disabled={!hasAvatar}>
                Reset transform
              </button>
            </div>
          </div>

          <div className="luna-section">
            <div className="luna-section-title">Expressions</div>
            <div className="luna-inline">
              <button
                className="luna-btn"
                onClick={() => setExpressionValues({})}
                disabled={!hasAvatar}
                title="Reset all expression preset values"
              >
                Reset expressions
              </button>
              <span className="luna-kv">Tip: set Aa/Ih/Ou/Ee/Oh for mouth shapes</span>
            </div>
            {EXPRESSION_PRESETS.map((preset) => {
              const key = String(preset);
              const value = expressionValues[key] ?? 0;
              return (
                <div key={key} className="luna-row">
                  <label>{key}</label>
                  <div className="luna-inline">
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={value}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        setExpressionValues((prev) => ({ ...prev, [key]: v }));
                      }}
                      disabled={!hasAvatar}
                    />
                    <span className="luna-kv">{value.toFixed(2)}</span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="luna-section">
            <div className="luna-section-title">Pose (Bones)</div>
            <div className="luna-inline">
              <select className="luna-select" value={poseBone} onChange={(e) => setPoseBone(e.target.value as VRMHumanBoneName)} disabled={!hasAvatar}>
                {POSE_BONES.map(({ label, bone }) => (
                  <option key={String(bone)} value={bone}>{label}</option>
                ))}
              </select>
              <button
                className="luna-btn"
                onClick={() => { setPoseRx(0); setPoseRy(0); setPoseRz(0); }}
                disabled={!hasAvatar}
                title="Reset current bone rotation"
              >
                Reset bone
              </button>
            </div>
            <div className="luna-row">
              <label>Rotate X</label>
              <div className="luna-inline">
                <input type="range" min={-1.6} max={1.6} step={0.01} value={poseRx} onChange={(e) => setPoseRx(Number(e.target.value))} disabled={!hasAvatar} />
                <span className="luna-kv">{poseRx.toFixed(2)}</span>
              </div>
            </div>
            <div className="luna-row">
              <label>Rotate Y</label>
              <div className="luna-inline">
                <input type="range" min={-1.6} max={1.6} step={0.01} value={poseRy} onChange={(e) => setPoseRy(Number(e.target.value))} disabled={!hasAvatar} />
                <span className="luna-kv">{poseRy.toFixed(2)}</span>
              </div>
            </div>
            <div className="luna-row">
              <label>Rotate Z</label>
              <div className="luna-inline">
                <input type="range" min={-1.6} max={1.6} step={0.01} value={poseRz} onChange={(e) => setPoseRz(Number(e.target.value))} disabled={!hasAvatar} />
                <span className="luna-kv">{poseRz.toFixed(2)}</span>
              </div>
            </div>
          </div>

          <div className="luna-display-canvas-wrap">
            <canvas ref={canvasRef} className="luna-display-canvas" />
          </div>

          <div className="luna-display-footer">
            <div className="luna-display-hint">
              Status: {status}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}




