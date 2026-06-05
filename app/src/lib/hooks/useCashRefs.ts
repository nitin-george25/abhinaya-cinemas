// ============================================================================
// useCashRefs — fetches operating units, bank accounts, and payment methods
// for the active cinema. Used by every cash management page so they don't
// each duplicate the lookup-table loading boilerplate.
// ============================================================================

import { useEffect, useState } from "react";

import {
  listBankAccounts,
  listOperatingUnits,
  listPaymentMethods,
  type BankAccount,
  type OperatingUnit,
  type PaymentMethod,
} from "../cash";
import { useSync } from "./SyncContext";

export interface CashRefs {
  loading:        boolean;
  cinemaId:       string | null;
  units:          OperatingUnit[];
  bankAccounts:   BankAccount[];
  paymentMethods: PaymentMethod[];
  /** Force a re-fetch (e.g. after a Settings change). */
  reload:         () => void;
}

export function useCashRefs(): CashRefs {
  const { state } = useSync();
  const cinemaId = state.cinemaId;

  const [loading, setLoading]               = useState(true);
  const [units, setUnits]                   = useState<OperatingUnit[]>([]);
  const [bankAccounts, setBankAccounts]     = useState<BankAccount[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [tick, setTick]                     = useState(0);

  useEffect(() => {
    if (!cinemaId) {
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    Promise.all([
      listOperatingUnits(cinemaId),
      listBankAccounts(cinemaId),
      listPaymentMethods(cinemaId),
    ])
      .then(([u, b, p]) => {
        if (!alive) return;
        setUnits(u);
        setBankAccounts(b);
        setPaymentMethods(p);
      })
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [cinemaId, tick]);

  return {
    loading,
    cinemaId,
    units,
    bankAccounts,
    paymentMethods,
    reload: () => setTick((t) => t + 1),
  };
}
