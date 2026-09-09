// Receipts newest first, grouped by month, with a per-month total header.
// Grouping only -- never re-sums in JS. Row bucketing uses the `month`
// column SQL already computed on each row; the totals come straight from
// monthlyTotals().
import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { listReceipts, monthlyTotals, type ReceiptRow, type MonthTotal } from '../db';
import { formatMoney } from '../lib/money';
import { colors } from '../theme';

// monthlyTotals() takes a row-count limit, not a distinct-month-count limit
// (GROUP BY month, currency -- a month with 2 currencies costs 2 rows of the
// limit). Its default of 6 would silently truncate before covering every
// month listReceipts() returns. There's no lib/db change needed for this --
// the function already accepts any limit -- so pass a generous ceiling
// instead of the default. A personal expense log will never come close.
const MONTH_TOTALS_LIMIT = 1000;

function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

type Props = {
  onAdd: () => void;
  onEdit: (receipt: ReceiptRow) => void;
};

export default function HomeScreen({ onAdd, onEdit }: Props) {
  const insets = useSafeAreaInsets();
  const [receipts, setReceipts] = useState<ReceiptRow[] | null>(null);
  const [totals, setTotals] = useState<MonthTotal[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [r, t] = await Promise.all([listReceipts(), monthlyTotals(MONTH_TOTALS_LIMIT)]);
      setReceipts(r);
      setTotals(t);
      setError(null);
    } catch (e) {
      setError(`Failed to load receipts: ${String(e)}`);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const groups = useMemo(() => {
    const map = new Map<string, ReceiptRow[]>();
    for (const r of receipts ?? []) {
      const arr = map.get(r.month);
      if (arr) arr.push(r);
      else map.set(r.month, [r]);
    }
    return [...map.entries()];
  }, [receipts]);

  const totalsByMonth = useMemo(() => {
    const map = new Map<string, MonthTotal[]>();
    for (const t of totals) {
      const arr = map.get(t.month);
      if (arr) arr.push(t);
      else map.set(t.month, [t]);
    }
    return map;
  }, [totals]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <Text style={styles.title}>Receipts</Text>
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 32 + 56 + 24 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {receipts !== null && receipts.length === 0 && (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No receipts yet.</Text>
            <Text style={styles.emptyText}>Tap the + button to log your first one.</Text>
          </View>
        )}

        {groups.map(([month, rows]) => (
          <View key={month} style={styles.monthGroup}>
            <View style={styles.monthHeader}>
              <Text style={styles.monthTitle}>{monthLabel(month)}</Text>
              {(totalsByMonth.get(month) ?? []).map((t) => (
                <Text key={t.currency} style={styles.monthTotal}>
                  {formatMoney(t.total_minor, t.currency)}
                </Text>
              ))}
            </View>

            {rows.map((r) => (
              <Pressable key={r.id} style={styles.row} onPress={() => onEdit(r)}>
                <View style={styles.rowLeft}>
                  <Text style={styles.merchant}>{r.merchant}</Text>
                  <Text style={styles.meta}>{r.category} · {r.spent_on}</Text>
                </View>
                <Text style={styles.amount}>{formatMoney(r.amount_minor, r.currency)}</Text>
              </Pressable>
            ))}
          </View>
        ))}
      </ScrollView>

      <Pressable
        style={[styles.fab, { right: 24, bottom: insets.bottom + 24 }]}
        onPress={onAdd}
      >
        <Text style={styles.fabText}>+</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  title: { fontSize: 24, fontWeight: '700', color: colors.text },
  fab: {
    position: 'absolute',
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
    elevation: 10,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  fabText: { color: colors.accentText, fontSize: 28, fontWeight: '600', lineHeight: 32 },
  error: { color: colors.danger, marginHorizontal: 16, marginBottom: 8, fontSize: 14 },
  scrollContent: { paddingBottom: 32 },
  empty: { padding: 32, alignItems: 'center', gap: 4 },
  emptyText: { color: colors.textMuted, fontSize: 15, textAlign: 'center' },
  monthGroup: { marginBottom: 8 },
  monthHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
    paddingVertical: 8,
    flexWrap: 'wrap',
  },
  monthTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  monthTotal: { fontSize: 14, fontWeight: '600', color: colors.text, marginLeft: 12 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  rowLeft: { flexShrink: 1, paddingRight: 8 },
  merchant: { fontSize: 16, fontWeight: '500', color: colors.text },
  meta: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  amount: { fontSize: 16, fontWeight: '600', color: colors.text },
});
