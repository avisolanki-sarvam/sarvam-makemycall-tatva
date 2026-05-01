/**
 * /credits — Credits detail page.
 *
 * Layout, top → bottom (dark surface throughout):
 *
 *   1. Back chevron + "Credits" title (display-md, Fraunces).
 *
 *   2. Balance hero — saturated brand-tinted tile showing the current
 *      credit balance in numeral-lg. Same indigo BrandSurface as Home.
 *
 *   3. "Add funds" pack grid — four pack tiles laid 2×2:
 *        ₹100  /  ₹500  /  ₹2,000  /  ₹10,000
 *      Tap → POST /credits/topup/order → RazorpayCheckout.open() →
 *      POST /credits/topup/verify. We avoid a custom-amount input on
 *      first pass — Indian SMB price psychology rewards a few clear
 *      price points over a slider.
 *
 *   4. Recent transactions — fed by GET /credits/transactions; empty
 *      state copy when the ledger is empty.
 *
 * Initial balance comes from /user/dashboard.creditBalance. After a
 * successful top-up we use the `balance` returned by /credits/topup/verify
 * to avoid an extra dashboard round-trip.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { CaretLeftIcon, WalletIcon, CheckIcon } from 'phosphor-react-native';
import RazorpayCheckout from 'react-native-razorpay';
import { api } from '../src/services/api';
import { useAuthStore } from '../src/stores/authStore';
import { TatvaColors, Radius, Spacing, Shadow, Weight } from '../src/constants/theme';
import { AppText } from '../src/components/AppText';

interface DashboardData {
  creditBalance: number;
}

interface OrderResponse {
  orderId: string;
  keyId: string;
  amount: number;
  currency: 'INR';
  credits: number;
  name: string;
  description: string;
}

interface VerifyResponse {
  balance: number;
  transactionId: string;
}

interface LedgerEntry {
  id: string;
  type: string;
  amount: number;
  balanceAfter: number;
  description: string;
  referenceId?: string | null;
  createdAt: string;
}

interface TransactionsResponse {
  transactions: LedgerEntry[];
}

// Razorpay's checkout returns the canonical paymentId/signature on success.
interface RazorpaySuccess {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

// Razorpay's failure object: code 0 = user dismissed, code 2 = network/cancel.
interface RazorpayError {
  code?: number;
  description?: string;
  message?: string;
}

interface CreditPack {
  credits: number;
  priceInr: number;
  /** Optional accent / promo label rendered top-right of the tile. */
  badge?: string;
}

// "2h ago" / "3d ago" / "just now". Cheap relative-time helper —
// inlined per scope rules (no new helper modules).
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const diffSec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (diffSec < 45) return 'just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 86400 * 7) return `${Math.floor(diffSec / 86400)}d ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

const PACKS: CreditPack[] = [
  { credits: 100,   priceInr: 100 },
  { credits: 500,   priceInr: 500,   badge: 'Most popular' },
  { credits: 2000,  priceInr: 2000 },
  { credits: 10000, priceInr: 10000, badge: 'Best value' },
];

export default function CreditsScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const [balance, setBalance] = useState<number | null>(null);
  const [purchasing, setPurchasing] = useState<number | null>(null);
  const [transactions, setTransactions] = useState<LedgerEntry[]>([]);

  // Defensive: backend MIGHT return the bare array during early dev. Handle both.
  const loadTransactions = useCallback(async () => {
    try {
      const res = await api.get<TransactionsResponse | LedgerEntry[]>('/credits/transactions');
      const list = Array.isArray(res) ? res : res?.transactions ?? [];
      setTransactions(list);
    } catch {
      setTransactions([]);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const dash = await api.get<DashboardData>('/user/dashboard');
        if (alive) setBalance(dash?.creditBalance ?? 0);
      } catch {
        if (alive) setBalance(0);
      }
    })();
    void loadTransactions();
    return () => {
      alive = false;
    };
  }, [loadTransactions]);

  const handleBuy = async (pack: CreditPack) => {
    setPurchasing(pack.credits);
    try {
      const order = await api.post<OrderResponse>('/credits/topup/order', {
        credits: pack.credits,
        priceInr: pack.priceInr,
      });

      const result = (await RazorpayCheckout.open({
        key: order.keyId,
        order_id: order.orderId,
        amount: order.amount,
        currency: order.currency,
        name: order.name,
        description: order.description,
        prefill: {
          contact: user?.phone,
          // User store doesn't expose email; Razorpay accepts undefined.
          email: (user as unknown as { email?: string })?.email,
        },
        theme: { color: TatvaColors.brandPrimary },
      })) as RazorpaySuccess;

      const settled = await api.post<VerifyResponse>('/credits/topup/verify', {
        orderId: order.orderId,
        paymentId: result.razorpay_payment_id,
        signature: result.razorpay_signature,
      });

      setBalance(settled.balance);
      Alert.alert('Top-up successful', `${pack.credits.toLocaleString('en-IN')} credits added.`);
      void loadTransactions();
    } catch (err: unknown) {
      const e = err as RazorpayError & { description?: string; message?: string };
      // Razorpay returns code 0 (user dismissed) or 2 (cancel/network) — treat as silent.
      if (e && (e.code === 0 || e.code === 2)) return;
      Alert.alert(
        'Top-up failed',
        e?.description || e?.message || 'Please try again.',
      );
    } finally {
      setPurchasing(null);
    }
  };

  return (
    <SafeAreaView style={styles.shell} edges={['top']}>
      {/* ─── Header ─────────────────────────────────────────────── */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <CaretLeftIcon size={22} color={TatvaColors.contentPrimary} weight="regular" />
        </TouchableOpacity>
        <AppText variant="heading-md">Credits</AppText>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ─── Balance hero ───────────────────────────────────── */}
        <View style={styles.balanceHero}>
          <View style={styles.balanceLabelRow}>
            <WalletIcon size={16} color={TatvaColors.brandContent} weight="regular" />
            <AppText
              variant="label-sm"
              style={{
                color: TatvaColors.brandContent,
                opacity: 0.85,
                textTransform: 'uppercase',
              }}
            >
              Available balance
            </AppText>
          </View>
          {balance === null ? (
            <ActivityIndicator color={TatvaColors.contentPrimary} />
          ) : (
            <AppText
              variant="numeral-lg"
              style={{ color: TatvaColors.contentPrimary, marginTop: Spacing['3'] }}
            >
              {balance.toLocaleString('en-IN')}
            </AppText>
          )}
          <AppText
            variant="body-sm"
            tone="tertiary"
            style={{ marginTop: Spacing['2'] }}
          >
            1 credit = 1 successful call connect
          </AppText>
        </View>

        {/* ─── Add funds ──────────────────────────────────────── */}
        <View style={styles.section}>
          <AppText variant="heading-sm" style={styles.sectionTitle}>
            Add funds
          </AppText>
          <AppText
            variant="body-sm"
            tone="tertiary"
            style={{ marginBottom: Spacing['6'] }}
          >
            Pick a pack to top up. Funds reflect instantly after payment.
          </AppText>

          <View style={styles.packGrid}>
            {PACKS.map((pack) => {
              const isLoading = purchasing === pack.credits;
              return (
                <TouchableOpacity
                  key={pack.credits}
                  style={styles.packTile}
                  activeOpacity={0.85}
                  onPress={() => handleBuy(pack)}
                  disabled={isLoading}
                >
                  {pack.badge ? (
                    <View style={styles.packBadge}>
                      <AppText
                        variant="label-sm"
                        style={{
                          color: TatvaColors.brandContent,
                          fontSize: 10,
                          letterSpacing: 0.4,
                        }}
                      >
                        {pack.badge.toUpperCase()}
                      </AppText>
                    </View>
                  ) : null}
                  <AppText
                    variant="numeral-md"
                    style={{ color: TatvaColors.contentPrimary }}
                  >
                    {pack.credits.toLocaleString('en-IN')}
                  </AppText>
                  <AppText variant="body-xs" tone="tertiary">
                    credits
                  </AppText>
                  <View style={styles.packPriceRow}>
                    {isLoading ? (
                      <ActivityIndicator size="small" color={TatvaColors.brandPrimary} />
                    ) : (
                      <AppText
                        variant="body-md"
                        style={{
                          color: TatvaColors.brandContent,
                          fontWeight: Weight.semibold,
                        }}
                      >
                        ₹{pack.priceInr.toLocaleString('en-IN')}
                      </AppText>
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* ─── Recent transactions ─────────────────────────────── */}
        <View style={styles.section}>
          <AppText variant="heading-sm" style={styles.sectionTitle}>
            Recent transactions
          </AppText>
          {transactions.length === 0 ? (
            <View style={styles.txnEmpty}>
              <AppText variant="body-sm" tone="tertiary" align="center">
                Your top-ups and call deductions will appear here.
              </AppText>
            </View>
          ) : (
            <View style={styles.txnList}>
              {transactions.slice(0, 10).map((t) => {
                const positive = t.amount > 0;
                const sign = positive ? '+' : '';
                return (
                  <View key={t.id} style={styles.txnRow}>
                    <View style={styles.txnRowMain}>
                      <AppText
                        variant="body-sm"
                        style={{ color: TatvaColors.contentPrimary }}
                        numberOfLines={1}
                      >
                        {t.description}
                      </AppText>
                      <AppText variant="body-xs" tone="tertiary">
                        {relativeTime(t.createdAt)}
                      </AppText>
                    </View>
                    <AppText
                      variant="numeral-md"
                      style={{
                        color: positive
                          ? TatvaColors.positiveContent
                          : TatvaColors.contentPrimary,
                      }}
                    >
                      {sign}
                      {t.amount.toLocaleString('en-IN')}
                    </AppText>
                  </View>
                );
              })}
            </View>
          )}
        </View>

        <View style={styles.disclaimerRow}>
          <CheckIcon size={14} color={TatvaColors.positiveContent} weight="bold" />
          <AppText variant="body-xs" tone="tertiary">
            Secure checkout. Refunds within 24 hours.
          </AppText>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: TatvaColors.surfacePrimary },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing['8'],
    paddingTop: Spacing['4'],
    paddingBottom: Spacing['4'],
  },
  backBtn: { paddingVertical: Spacing['2'] },

  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: Spacing['8'], paddingBottom: Spacing['8'] },

  // ─── Balance hero ───────────────────────────────────────────
  balanceHero: {
    backgroundColor: TatvaColors.brandSurface,
    borderRadius: Radius.lg,
    padding: Spacing['12'],
    marginTop: Spacing['4'],
    marginBottom: Spacing['10'],
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: TatvaColors.brandPrimary,
  },
  balanceLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing['3'],
  },

  // ─── Section ────────────────────────────────────────────────
  section: { marginBottom: Spacing['10'] },
  sectionTitle: { marginBottom: Spacing['2'] },

  // ─── Pack grid ──────────────────────────────────────────────
  packGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing['5'],
  },
  packTile: {
    width: '48%',
    backgroundColor: TatvaColors.surfaceSecondary,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: TatvaColors.borderSecondary,
    padding: Spacing['8'],
    alignItems: 'flex-start',
    gap: Spacing['1'],
    minHeight: 130,
    ...Shadow.l1,
  },
  packBadge: {
    position: 'absolute',
    top: Spacing['4'],
    right: Spacing['4'],
    backgroundColor: TatvaColors.brandSurface,
    paddingHorizontal: Spacing['3'],
    paddingVertical: Spacing['1'],
    borderRadius: Radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: TatvaColors.brandPrimary,
  },
  packPriceRow: {
    marginTop: Spacing['3'],
    minHeight: 22,
    justifyContent: 'center',
  },

  // ─── Transactions empty ─────────────────────────────────────
  txnEmpty: {
    backgroundColor: TatvaColors.surfaceSecondary,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
    borderColor: TatvaColors.borderSecondary,
    padding: Spacing['10'],
  },

  // ─── Transactions list ──────────────────────────────────────
  txnList: {
    backgroundColor: TatvaColors.surfaceSecondary,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: TatvaColors.borderSecondary,
    overflow: 'hidden',
    ...Shadow.l1,
  },
  txnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing['4'],
    paddingHorizontal: Spacing['8'],
    paddingVertical: Spacing['6'],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: TatvaColors.borderPrimary,
  },
  txnRowMain: {
    flex: 1,
    gap: Spacing['1'],
  },

  // ─── Disclaimer ─────────────────────────────────────────────
  disclaimerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing['3'],
    marginTop: Spacing['4'],
  },
});
