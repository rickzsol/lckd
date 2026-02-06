"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import type { WizardContext } from "@/hooks/useLaunchWizard";

export default function StepTokenDetails({ w }: { w: WizardContext }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  return (
    <div>
      <div className="mb-5 font-mono text-[13px] font-bold text-emerald-accent">
        01 &mdash; Token Details
      </div>

      <div className="flex flex-col gap-4">
        {/* Image upload */}
        <div>
          <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-[#555]">
            Token Image *
          </label>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) w.handleImageUpload(file);
            }}
          />

          {w.imagePreview ? (
            <div className="group relative inline-block">
              <Image
                src={w.imagePreview}
                alt="Token preview"
                width={90}
                height={90}
                className="h-[90px] w-[90px] rounded-[14px] border border-white/10 object-cover"
                unoptimized
              />
              <button
                onClick={w.removeImage}
                className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-red-500/90 text-[10px] font-bold text-white opacity-0 transition-opacity group-hover:opacity-100"
                aria-label="Remove image"
              >
                X
              </button>
            </div>
          ) : (
            <div
              role="button"
              tabIndex={0}
              className={`upload-box transition-colors ${isDragging ? "border-emerald-accent/50 bg-emerald-accent/5" : ""}`}
              onClick={() => fileRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") fileRef.current?.click();
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                const file = e.dataTransfer.files[0];
                if (file) w.handleImageUpload(file);
              }}
            >
              <span className="text-2xl">+</span>
              <span className="text-[10px] text-[#555]">
                {isDragging ? "drop here" : "drag or click"}
              </span>
            </div>
          )}

          {w.errors.image && (
            <div className="mt-1 font-mono text-[10px] text-red-400">
              {w.errors.image}
            </div>
          )}
          <div className="mt-1 font-mono text-[9px] text-[#333]">
            PNG, JPG, GIF, WebP &middot; max 5MB
          </div>
        </div>

        {/* Name + Ticker */}
        <div className="flex flex-col gap-2.5 sm:flex-row">
          <div className="flex-[2]">
            <label
              htmlFor="token-name"
              className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-[#555]"
            >
              Name *
            </label>
            <input
              id="token-name"
              placeholder="e.g. NeuralSwap"
              className="form-input"
              maxLength={32}
              value={w.config.name}
              onChange={(e) => w.updateConfig("name", e.target.value)}
            />
            {w.errors.name && (
              <div className="mt-1 font-mono text-[10px] text-red-400">
                {w.errors.name}
              </div>
            )}
          </div>
          <div className="flex-1">
            <label
              htmlFor="token-ticker"
              className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-[#555]"
            >
              Ticker *
            </label>
            <input
              id="token-ticker"
              placeholder="$NSWAP"
              className="form-input uppercase"
              maxLength={10}
              value={w.config.ticker}
              onChange={(e) =>
                w.updateConfig("ticker", e.target.value.toUpperCase())
              }
            />
            {w.errors.ticker && (
              <div className="mt-1 font-mono text-[10px] text-red-400">
                {w.errors.ticker}
              </div>
            )}
          </div>
        </div>

        {/* Description */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label
              htmlFor="token-desc"
              className="font-mono text-[10px] uppercase tracking-wider text-[#555]"
            >
              Description *
            </label>
            <span
              className={`font-mono text-[10px] ${w.config.description.length > 500 ? "text-red-400" : "text-[#333]"}`}
            >
              {w.config.description.length} / 500
            </span>
          </div>
          <textarea
            id="token-desc"
            placeholder="What are you building?"
            rows={3}
            maxLength={500}
            className="form-input resize-y"
            value={w.config.description}
            onChange={(e) => w.updateConfig("description", e.target.value)}
          />
          {w.errors.description && (
            <div className="mt-1 font-mono text-[10px] text-red-400">
              {w.errors.description}
            </div>
          )}
        </div>

        {/* Social links */}
        <div className="flex flex-col gap-2.5">
          <div className="font-mono text-[10px] uppercase tracking-wider text-[#444]">
            Social Links (optional)
          </div>
          <div className="flex flex-col gap-2.5 sm:flex-row">
            <div className="flex-1">
              <input
                placeholder="Twitter URL"
                className="form-input"
                value={w.config.twitterUrl ?? ""}
                onChange={(e) =>
                  w.updateConfig("twitterUrl", e.target.value || null)
                }
              />
              {w.errors.twitterUrl && (
                <div className="mt-1 font-mono text-[10px] text-red-400">
                  {w.errors.twitterUrl}
                </div>
              )}
            </div>
            <div className="flex-1">
              <input
                placeholder="Telegram URL"
                className="form-input"
                value={w.config.telegramUrl ?? ""}
                onChange={(e) =>
                  w.updateConfig("telegramUrl", e.target.value || null)
                }
              />
              {w.errors.telegramUrl && (
                <div className="mt-1 font-mono text-[10px] text-red-400">
                  {w.errors.telegramUrl}
                </div>
              )}
            </div>
          </div>
          <div>
            <input
              placeholder="Website URL"
              className="form-input"
              value={w.config.websiteUrl ?? ""}
              onChange={(e) =>
                w.updateConfig("websiteUrl", e.target.value || null)
              }
            />
            {w.errors.websiteUrl && (
              <div className="mt-1 font-mono text-[10px] text-red-400">
                {w.errors.websiteUrl}
              </div>
            )}
          </div>
        </div>
      </div>

      <button onClick={w.goNext} className="btn-primary mt-6 w-full py-3">
        continue &rarr;
      </button>
    </div>
  );
}
