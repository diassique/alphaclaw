/**
 * Input validation helpers for Express routes.
 * Each returns the validated value, or null if validation failed (response already sent).
 */

import type { Request, Response } from "express";

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

// ─── String ────────────────────────────────────────────────────────────────

interface StringOpts {
  required?: boolean;
  maxLen?: number;
  defaultVal?: string;
}

export function validateString(
  req: Request,
  res: Response,
  field: string,
  opts: StringOpts = {},
): string | null {
  const raw = (req.body as Record<string, unknown>)?.[field];
  const val = typeof raw === "string" ? raw.trim() : undefined;

  if (!val && opts.required) {
    res.status(400).json({
      error: `Missing required field '${field}'`,
      code: "VALIDATION_ERROR",
    });
    return null;
  }

  const result = val || opts.defaultVal || "";

  if (opts.maxLen && result.length > opts.maxLen) {
    res.status(400).json({
      error: `Field '${field}' exceeds max length ${opts.maxLen}`,
      code: "VALIDATION_ERROR",
    });
    return null;
  }

  return result;
}

// ─── Address ───────────────────────────────────────────────────────────────

interface AddressOpts {
  required?: boolean;
  defaultVal?: string;
}

export function validateAddress(
  req: Request,
  res: Response,
  field: string,
  opts: AddressOpts = {},
): string | null {
  const raw = (req.body as Record<string, unknown>)?.[field];
  const val = typeof raw === "string" ? raw.trim() : undefined;

  if (!val && opts.required) {
    res.status(400).json({
      error: `Missing required field '${field}'`,
      code: "VALIDATION_ERROR",
    });
    return null;
  }

  const result = val || opts.defaultVal || "";

  if (result && !EVM_ADDRESS.test(result)) {
    res.status(400).json({
      error: `Invalid address in '${field}' — expected 0x + 40 hex chars`,
      code: "VALIDATION_ERROR",
    });
    return null;
  }

  return result;
}

// ─── Integer ───────────────────────────────────────────────────────────────

interface IntOpts {
  min?: number;
  max?: number;
  defaultVal?: number;
}

export function validateInt(
  req: Request,
  res: Response,
  field: string,
  opts: IntOpts = {},
): number | null {
  const raw = (req.body as Record<string, unknown>)?.[field];
  const parsed = typeof raw === "number" ? raw : parseInt(String(raw ?? ""), 10);
  const val = Number.isFinite(parsed) ? parsed : opts.defaultVal;

  if (val === undefined) {
    res.status(400).json({
      error: `Missing or invalid integer field '${field}'`,
      code: "VALIDATION_ERROR",
    });
    return null;
  }

  if (opts.min !== undefined && val < opts.min) return opts.min;
  if (opts.max !== undefined && val > opts.max) return opts.max;
  return Math.floor(val);
}
