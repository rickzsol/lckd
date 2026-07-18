"use client";

import { signIn, useSession } from "next-auth/react";
import MatchForm from "./MatchForm";

const STEPS = [
  {
    num: 1,
    title: "apply with your github and launch plan",
    body: "Sign in with GitHub, tell us about the project, and share how much SOL you plan to buy at launch.",
  },
  {
    num: 2,
    title: "selected projects get matched",
    body: "We review applications by hand. If your launch is selected, LCKD matches your dev buy with an equal lock.",
  },
  {
    num: 3,
    title: "both locks run side by side",
    body: "Your lock and the matched lock share the same cliff. When it expires, the full matched supply returns to you.",
  },
];

export default function MatchClient() {
  const { data: session, status } = useSession();
  const isAuthenticated = status === "authenticated" && !!session?.github_username;

  return (
    <div className="mx-auto max-w-[680px] px-4 pt-28 pb-16 sm:px-6">
      <h1 className="font-sans text-[clamp(28px,7vw,44px)] font-bold tracking-[-0.02em] text-text-1">
        Matched launches
      </h1>
      <p className="mt-4 max-w-xl text-base leading-7 text-text-2">
        Building something real and launching it with LCKD? For selected launches, we
        match your dev buy and lock it alongside you, on the same terms, for the same
        duration. We want to back builders, not just launches.
      </p>

      <div className="mt-10 flex flex-col gap-5">
        {STEPS.map((step) => (
          <div key={step.num} className="flex gap-3.5">
            <div className="review-num mt-0.5">{step.num}</div>
            <div>
              <div className="font-mono text-xs font-bold text-text-1">{step.title}</div>
              <p className="mt-1 text-sm leading-6 text-text-2">{step.body}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="warning-box mt-8">
        <span className="callout-title">terms and eligibility</span>
        Selection is manual and not guaranteed. Matched tokens sit in the same
        non-cancelable Streamflow cliff lock as your own, the full matched supply
        returns to you at lock expiry, and this is a platform program, not investment
        advice.
      </div>

      <div className="mt-10">
        {!isAuthenticated ? (
          <div>
            <h2 className="font-mono text-[13px] font-bold text-accent">apply</h2>
            <p className="mt-3 max-w-xl text-sm leading-6 text-text-2">
              Sign in with GitHub to submit an application. We use your account to
              verify repository ownership and to follow up on selected launches.
            </p>
            <button
              type="button"
              onClick={() => signIn("github", { callbackUrl: "/match" })}
              className="btn-primary mt-5 px-6"
            >
              sign in with github
            </button>
          </div>
        ) : (
          <MatchForm username={session.github_username} />
        )}
      </div>
    </div>
  );
}
