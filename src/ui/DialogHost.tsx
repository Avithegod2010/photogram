import React, { useEffect, useRef, useState } from "react";
import { Dialog } from "./Dialog";
import { t } from "../lib/i18n";

export type ConfirmOptions = {
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
};

type Pending = { options: ConfirmOptions; resolve: (ok: boolean) => void; single: boolean };

/**
 * A tiny imperative dialog queue so screens do not each need local modal state.
 * Mount <DialogHost /> once (App.tsx) and call confirmDialog / alertDialog.
 *
 * Behaviour matches Alert.alert: one dialog at a time, newest waits its turn,
 * cancel/dismiss resolves false.
 */
let queue: Pending[] = [];
let notify: (() => void) | null = null;

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    queue.push({ options, resolve, single: false });
    notify?.();
  });
}

export function alertDialog(options: Omit<ConfirmOptions, "confirmLabel" | "cancelLabel"> & { buttonLabel?: string }): Promise<void> {
  const { buttonLabel, ...rest } = options;
  return new Promise<void>((resolve) => {
    queue.push({
      options: { ...rest, confirmLabel: buttonLabel ?? t("common.ok") },
      resolve: () => resolve(),
      single: true,
    });
    notify?.();
  });
}

export function DialogHost() {
  const [current, setCurrent] = useState<Pending | null>(null);
  const currentRef = useRef<Pending | null>(null);
  currentRef.current = current;

  useEffect(() => {
    const n = () => {
      setCurrent((prev) => prev ?? queue[0] ?? null);
    };
    notify = n;
    n();
    return () => {
      notify = null;
    };
  }, []);

  const finish = (value: boolean) => {
    const p = currentRef.current;
    if (!p) return;
    queue = queue.filter((q) => q !== p);
    setCurrent(null);
    p.resolve(value);
    // Show the next request on the following frame.
    requestAnimationFrame(() => {
      setCurrent((prev) => prev ?? queue[0] ?? null);
    });
  };

  return (
    <Dialog
      visible={!!current}
      title={current?.options.title ?? ""}
      message={current?.options.message}
      confirmLabel={current?.options.confirmLabel ?? t("common.ok")}
      cancelLabel={current?.single ? undefined : current?.options.cancelLabel ?? t("common.cancel")}
      destructive={current?.options.destructive}
      onConfirm={() => finish(true)}
      onCancel={() => finish(false)}
    />
  );
}
