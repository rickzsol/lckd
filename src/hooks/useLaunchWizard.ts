"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import { type LaunchConfig, TrustTier } from "@/types/index";
import { useTokenLaunch } from "./useTokenLaunch";

export { type LaunchStatus, type LaunchResult, type LaunchDeps } from "./useTokenLaunch";
export { LAUNCH_PHASES_WITH_LOCK } from "./useTokenLaunch";

export const STEP_LABELS = [
  "Token Details",
  "Lock Config",
  "GitHub",
  "Review & Launch",
] as const;

export const STEP_COUNT = 4;

const STORAGE_KEY = "lckd_launch_wizard";
const METADATA_FIELDS = new Set<keyof LaunchConfig>([
  "name",
  "ticker",
  "description",
  "twitterUrl",
  "telegramUrl",
  "websiteUrl",
]);

const INITIAL_CONFIG: LaunchConfig = {
  name: "",
  ticker: "",
  description: "",
  image: null,
  imageUri: null,
  buyAmountSol: 1,
  lockDurationDays: 90,
  lockPercentage: 99,
  githubUsername: null,
  githubRepo: null,
  liveUrl: null,
  twitterUrl: null,
  telegramUrl: null,
  websiteUrl: null,
};

function isValidUrl(str: string): boolean {
  try {
    return new URL(str).protocol === "https:";
  } catch {
    return false;
  }
}

function loadSavedState(): { config: LaunchConfig; step: number } {
  try {
    if (typeof window === "undefined") return { config: INITIAL_CONFIG, step: 1 };
    const saved = sessionStorage.getItem(STORAGE_KEY);
    if (!saved) return { config: INITIAL_CONFIG, step: 1 };
    const parsed = JSON.parse(saved);
    const savedStep = Number(parsed.step);
    return {
      config: parsed.config
        ? {
            ...INITIAL_CONFIG,
            ...parsed.config,
            lockPercentage: Math.min(Number(parsed.config.lockPercentage ?? 99), 99),
            image: null,
          }
        : INITIAL_CONFIG,
      step: Number.isInteger(savedStep) && savedStep >= 1 && savedStep <= STEP_COUNT
        ? savedStep
        : 1,
    };
  } catch {
    return { config: INITIAL_CONFIG, step: 1 };
  }
}

export function useLaunchWizard() {
  const [initialState] = useState(loadSavedState);
  const [step, setStep] = useState(initialState.step);
  const [config, setConfig] = useState<LaunchConfig>(initialState.config);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const {
    launchStatus,
    launchPhase,
    launchPhases,
    launchResult,
    recoveredConfig,
    errorMessage,
    launch,
    retryLock,
    cleanupLookup,
    recoveryStatus,
    recoveryAltStatus,
    resetLaunch,
  } = useTokenLaunch(config);

  useEffect(() => {
    if (!recoveredConfig) return;
    const timeout = window.setTimeout(() => {
      setConfig((current) => ({ ...current, ...recoveredConfig, image: current.image }));
      setStep(STEP_COUNT);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [recoveredConfig]);

  // Persist state to sessionStorage on change
  useEffect(() => {
    const serializable = { ...config, image: undefined };
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ config: serializable, step }),
    );
  }, [config, step]);

  const updateConfig = useCallback(
    <K extends keyof LaunchConfig>(key: K, value: LaunchConfig[K]) => {
      setConfig((prev) => ({
        ...prev,
        [key]: value,
        ...(METADATA_FIELDS.has(key) && prev[key] !== value ? { imageUri: null } : {}),
      }));
      setErrors((prev) => {
        if (!prev[key]) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
    },
    [],
  );

  const handleImageUpload = useCallback((file: File) => {
    const MAX_SIZE = 4 * 1024 * 1024;
    const ALLOWED = ["image/png", "image/jpeg", "image/gif", "image/webp"];

    if (!ALLOWED.includes(file.type)) {
      setErrors((p) => ({ ...p, image: "Only PNG, JPG, GIF, WebP allowed" }));
      return;
    }
    if (file.size > MAX_SIZE) {
      setErrors((p) => ({ ...p, image: "Image must be under 5MB" }));
      return;
    }

    setConfig((prev) => ({ ...prev, image: file, imageUri: null }));
    setErrors((p) => {
      const n = { ...p };
      delete n.image;
      return n;
    });

    const reader = new FileReader();
    reader.onload = (e) => setImagePreview(e.target?.result as string);
    reader.readAsDataURL(file);
  }, []);

  const removeImage = useCallback(() => {
    setConfig((prev) => ({ ...prev, image: null, imageUri: null }));
    setImagePreview(null);
  }, []);

  // --- Validation ---
  const validateStep1 = useCallback((): boolean => {
    const errs: Record<string, string> = {};
    const name = config.name.trim();
    if (!name) errs.name = "Token name is required";
    else if (name.length < 2) errs.name = "Min 2 characters";
    else if (name.length > 32) errs.name = "Max 32 characters";

    const ticker = config.ticker.trim();
    if (!ticker) errs.ticker = "Ticker is required";
    else if (ticker.length < 2) errs.ticker = "Min 2 characters";
    else if (ticker.length > 10) errs.ticker = "Max 10 characters";

    if (!config.image && !config.imageUri) errs.image = "Token image is required";

    const desc = config.description.trim();
    if (!desc) errs.description = "Description is required";
    else if (desc.length > 500) errs.description = "Max 500 characters";

    if (config.twitterUrl && !isValidUrl(config.twitterUrl))
      errs.twitterUrl = "Enter a valid URL";
    if (config.telegramUrl && !isValidUrl(config.telegramUrl))
      errs.telegramUrl = "Enter a valid URL";
    if (config.websiteUrl && !isValidUrl(config.websiteUrl))
      errs.websiteUrl = "Enter a valid URL";

    setErrors(errs);
    return Object.keys(errs).length === 0;
  }, [config]);

  const validateStep2 = useCallback((): boolean => {
    const errs: Record<string, string> = {};
    if (config.buyAmountSol < 0.01)
      errs.buyAmountSol = "Minimum buy is 0.01 SOL";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }, [config.buyAmountSol]);

  // --- Navigation ---
  const goNext = useCallback(() => {
    if (step === 1 && !validateStep1()) return;
    if (step === 2 && !validateStep2()) return;
    if (step < STEP_COUNT) {
      setErrors({});
      setStep((s) => s + 1);
    }
  }, [step, validateStep1, validateStep2]);

  const goBack = useCallback(() => {
    if (step > 1) {
      setErrors({});
      setStep((s) => s - 1);
    }
  }, [step]);

  const goToStep = useCallback(
    (target: number) => {
      if (target < 1 || target > STEP_COUNT) return;
      if (target <= step) {
        setErrors({});
        setStep(target);
        return;
      }
      if (step <= 1 && target > 1 && !validateStep1()) return;
      if (step <= 2 && target > 2 && !validateStep2()) return;
      setErrors({});
      setStep(target);
    },
    [step, validateStep1, validateStep2],
  );

  // --- Trust tier ---
  const computedTier = useMemo((): TrustTier => {
    if (!config.githubUsername) return TrustTier.LOCKED;
    if (config.githubRepo && config.liveUrl) return TrustTier.SHIPPED;
    if (config.githubRepo) return TrustTier.BUILDER;
    return TrustTier.VERIFIED;
  }, [config.githubUsername, config.githubRepo, config.liveUrl]);

  const tierLabel = useMemo(() => {
    const map: Record<TrustTier, string> = {
      [TrustTier.LOCKED]: "LOCKED",
      [TrustTier.VERIFIED]: "VERIFIED",
      [TrustTier.BUILDER]: "BUILDER",
      [TrustTier.SHIPPED]: "SHIPPED",
    };
    return map[computedTier];
  }, [computedTier]);

  const reset = useCallback(async () => {
    if (!await resetLaunch()) return;
    setStep(1);
    setConfig(INITIAL_CONFIG);
    setImagePreview(null);
    setErrors({});
    sessionStorage.removeItem(STORAGE_KEY);
  }, [resetLaunch]);

  return {
    step,
    config,
    imagePreview,
    errors,
    launchStatus,
    launchPhase,
    launchPhases,
    launchResult,
    errorMessage,
    computedTier,
    tierLabel,
    updateConfig,
    handleImageUpload,
    removeImage,
    goNext,
    goBack,
    goToStep,
    launch,
    retryLock,
    cleanupLookup,
    recoveryStatus,
    recoveryAltStatus,
    reset,
  };
}

export type WizardContext = ReturnType<typeof useLaunchWizard>;
