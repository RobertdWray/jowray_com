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
  message: "Integrations never import services/ (services import integrations).",
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
    files: ["integrations/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [noFeatureImports, noServiceImports, noAppImports] },
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
    files: [
      "app/**/*-form.tsx",
      "app/**/*-client.tsx",
      "app/**/recorder.ts",
      "app/global-error.tsx",
      "instrumentation-client.ts",
    ],
    rules: {
      "no-restricted-imports": ["error", { patterns: [noServerFromClient] }],
    },
  },
  {
    files: ["app/**/*.{ts,tsx}"],
    ignores: ["app/**/*-form.tsx", "app/**/*-client.tsx", "app/**/recorder.ts", "app/global-error.tsx"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [noIntegrationsFromFeatures] }],
    },
  },
  {
    files: ["scripts/**/*.ts", "prisma/**/*.ts"],
    rules: {
      // CLI scripts run under tsx and talk to a terminal.
      "no-console": "off",
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "generated/**", ".reference/**"]),
]);

export default eslintConfig;
