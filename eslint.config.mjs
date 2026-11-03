import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Import direction (docs/code-layout.md): app/ → features/ → services/ → integrations/.
// lib/ and server/ are leaves that any layer may use; nothing imports app/.
const noIntegrationsFromFeatures = {
  group: ["@/integrations", "@/integrations/*"],
  message:
    "Import from @/services, not @/integrations. Services define the interface; integrations implement it.",
};
const noAppImports = {
  group: ["@/app", "@/app/*"],
  message: "Nothing imports from app/. Move shared code to features/, services/ or lib/.",
};
const noFeatureImports = {
  group: ["@/features", "@/features/*"],
  message: "Lower layers never import features/.",
};
const noServiceImports = {
  group: ["@/services", "@/services/*"],
  message: "Only features/ import services/ (app/ calls features; integrations implement service interfaces).",
};
const noServerFromClient = {
  group: ["@/server", "@/server/*", "@/integrations", "@/integrations/*"],
  message:
    "Client Components cannot import server modules or integrations. Call a Server Function instead.",
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Pino on the server; console only for the two levels Vercel surfaces as errors.
      "no-console": ["error", { allow: ["warn", "error"] }],
      eqeqeq: ["error", "always"],
      curly: ["error", "all"],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/ban-ts-comment": [
        "error",
        {
          "ts-ignore": true,
          "ts-nocheck": true,
          "ts-expect-error": "allow-with-description",
          minimumDescriptionLength: 20,
        },
      ],
    },
  },
  {
    files: ["features/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [noIntegrationsFromFeatures, noAppImports] }],
    },
  },
  {
    files: ["services/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [noFeatureImports, noAppImports] }],
    },
  },
  {
    // Integrations implement the interfaces that services/ declare, so type-only
    // imports from services/ are allowed; value imports are not.
    files: ["integrations/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": "off",
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            noFeatureImports,
            { ...noServiceImports, allowTypeImports: true },
            noAppImports,
          ],
        },
      ],
    },
  },
  {
    files: ["lib/**/*.{ts,tsx}", "server/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            noFeatureImports,
            noServiceImports,
            noIntegrationsFromFeatures,
            noAppImports,
          ],
        },
      ],
    },
  },
  {
    // Client Components by convention: *-form.tsx, *-client.tsx, recorder.ts, instrumentation-client.ts.
    // app/_components/ is shared by Client Components, so it follows the same rule.
    files: [
      "app/**/*-form.tsx",
      "app/**/*-client.tsx",
      "app/**/recorder.ts",
      "app/**/error.tsx",
      "app/global-error.tsx",
      "app/_components/**/*.{ts,tsx}",
      "instrumentation-client.ts",
    ],
    rules: {
      "no-restricted-imports": ["error", { patterns: [noServerFromClient, noServiceImports] }],
    },
  },
  {
    // Route handlers are the HTTP adapter layer: features/ and services/ are
    // both fine there, integrations/ never.
    files: ["app/api/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [noIntegrationsFromFeatures] }],
    },
  },
  {
    files: ["app/**/*.{ts,tsx}"],
    ignores: ["app/api/**", "app/**/*-form.tsx", "app/**/*-client.tsx", "app/**/recorder.ts", "app/**/error.tsx", "app/global-error.tsx", "app/_components/**/*.{ts,tsx}"],
    rules: {
      // Pages and Server Functions call features/ (and lib/, server/); never services/ or integrations/ directly.
      "no-restricted-imports": ["error", { patterns: [noIntegrationsFromFeatures, noServiceImports] }],
    },
  },
  {
    files: ["scripts/**/*.ts", "prisma/**/*.ts"],
    rules: {
      // CLI scripts run under tsx and talk to a terminal.
      "no-console": "off",
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "generated/**",
    ".reference/**",
    ".superpowers/**",
  ]),
]);

export default eslintConfig;
