// Monthly spend bar chart, one block per currency (most-spent first), with a
// tap-to-drill-down category breakdown. Bars are plain Views sized by
// bar.fraction -- no chart lib, this is Expo Go with no native deps.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { monthlyTotals, categoryBreakdown, type CategoryTotal } from '../db';
import { toSeries, type Bar, type Series } from '../lib/chart';
import { todayISO } from '../lib/dates';
import { formatMoney } from '../lib/money';
import { colors } from '../theme';

const MONTHS_SHOWN = 6;
const CHART_HEIGHT = 140;
const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];
const FULL_MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

type Selected = { month: string; currency: string };

type Props = {
  onBack: () => void;
};

export default function ChartsScreen({ onBack }: Props) {
  const insets = useSafeAreaInsets();
  const [series, setSeries] = useState<Series[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [breakdown, setBreakdown] = useState<CategoryTotal[] | null>(null);

  const load = useCallback(async () => {
    try {
      const rows = await monthlyTotals(MONTHS_SHOWN);
      const currentMonth = todayISO().slice(0, 7);
      setSeries(toSeries(rows, currentMonth, MONTHS_SHOWN));
      setError(null);
    } catch (e) {
      setError(`Failed to load chart data: ${String(e)}`);
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

  // The peak bar per currency is called out in the heading even when it
  // isn't selected, so the chart is still readable without tapping anything.
  const peakByCurrency = useMemo(() => {
    const map = new Map<string, { month: string; totalMinor: number }>();
    for (const s of series ?? []) {
      let peak = { month: '', totalMinor: 0 };
      for (const bar of s.bars) {
        if (bar.totalMinor > peak.totalMinor) peak = { month: bar.month, totalMinor: bar.totalMinor };
      }
      map.set(s.currency, peak);
    }
    return map;
  }, [series]);

  function selectBar(currency: string, bar: Bar) {
    if (bar.totalMinor === 0) return; // nothing to drill into for a zero-spend month

    if (selected && selected.month === bar.month && selected.currency === currency) {
      setSelected(null);
      setBreakdown(null);
      return;
    }

    setSelected({ month: bar.month, currency });
    setBreakdown(null);
    categoryBreakdown(bar.month, currency)
      .then(setBreakdown)
      .catch((e) => setError(`Failed to load category breakdown: ${String(e)}`));
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {/* Expo Go's dev-menu gear floats over the top-right corner of every
          screen, so Back lives bottom-left instead -- the same corner
          HomeScreen's Charts pill uses, making bottom-left the consistent
          "go to the other screen" spot across both screens. */}
      <View style={styles.header}>
        <Text style={styles.title}>Charts</Text>
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 32 + 56 + 24 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {series !== null && series.length === 0 && (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No spending to chart yet.</Text>
          </View>
        )}

        {(series ?? []).map((s) => {
          const peak = peakByCurrency.get(s.currency);
          const selectedBar =
            selected?.currency === s.currency ? s.bars.find((b) => b.month === selected.month) : undefined;

          return (
            <View key={s.currency} style={styles.chartBlock}>
              <View style={styles.currencyHeadingRow}>
                <Text style={styles.currencyHeading}>{s.currency}</Text>
                {peak && peak.totalMinor > 0 && (
                  <Text style={styles.peakText}>
                    Peak {MONTH_LABELS[Number(peak.month.slice(5, 7)) - 1]} · {formatMoney(peak.totalMinor, s.currency)}
                  </Text>
                )}
              </View>

              <View style={styles.barsRow}>
                {s.bars.map((bar) => {
                  const isSelected = selected?.currency === s.currency && selected.month === bar.month;
                  const monthIndex = Number(bar.month.slice(5, 7)) - 1;

                  return (
                    <Pressable key={bar.month} style={styles.barColumn} onPress={() => selectBar(s.currency, bar)}>
                      <View style={styles.barTrack}>
                        {bar.totalMinor > 0 && (
                          <View
                            style={[
                              styles.bar,
                              { height: CHART_HEIGHT * bar.fraction },
                              isSelected && styles.barSelected,
                            ]}
                          />
                        )}
                      </View>
                      <Text style={styles.monthLabel}>{MONTH_LABELS[monthIndex]}</Text>
                    </Pressable>
                  );
                })}
              </View>

              {selectedBar && (
                <Text style={styles.selectedMonthText}>
                  {FULL_MONTH_LABELS[Number(selectedBar.month.slice(5, 7)) - 1]} {selectedBar.month.slice(0, 4)} ·{' '}
                  {formatMoney(selectedBar.totalMinor, s.currency)}
                </Text>
              )}

              {selected?.currency === s.currency && breakdown && (
                <View style={styles.breakdownList}>
                  {breakdown.map((c) => (
                    <View key={c.category} style={styles.breakdownRow}>
                      <Text style={styles.breakdownCategory}>{c.category}</Text>
                      <Text style={styles.breakdownMeta}>{c.n}</Text>
                      <Text style={styles.breakdownAmount}>{formatMoney(c.total_minor, s.currency)}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>

      {/* Bottom-left, mirroring HomeScreen's Charts pill exactly -- see the
          comment above the header for why this corner and not top-right. */}
      <Pressable
        style={[styles.backPill, { left: 24, bottom: insets.bottom + 24 }]}
        onPress={onBack}
      >
        <Text style={styles.backPillText}>Back</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  title: { fontSize: 24, fontWeight: '700', color: colors.text },
  error: { color: colors.danger, marginHorizontal: 16, marginBottom: 8, fontSize: 14 },
  scrollContent: { paddingBottom: 32 },
  empty: { padding: 32, alignItems: 'center', gap: 4 },
  emptyText: { color: colors.textMuted, fontSize: 15, textAlign: 'center' },
  chartBlock: { marginBottom: 24, paddingHorizontal: 16 },
  currencyHeadingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 12,
  },
  currencyHeading: { fontSize: 15, fontWeight: '700', color: colors.text },
  peakText: { fontSize: 13, fontWeight: '600', color: colors.textMuted },
  barsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  barColumn: { flex: 1, alignItems: 'center' },
  barTrack: { height: CHART_HEIGHT, width: 24, justifyContent: 'flex-end' },
  bar: { width: 24, minHeight: 2, borderRadius: 4, backgroundColor: colors.accent },
  barSelected: { backgroundColor: colors.text },
  monthLabel: { fontSize: 12, color: colors.textMuted, marginTop: 6 },
  selectedMonthText: { fontSize: 14, fontWeight: '600', color: colors.text, marginTop: 16 },
  breakdownList: { marginTop: 16, backgroundColor: colors.surface, borderRadius: 8, overflow: 'hidden' },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  breakdownCategory: { flex: 1, fontSize: 14, color: colors.text },
  breakdownMeta: { fontSize: 13, color: colors.textMuted, marginHorizontal: 8 },
  breakdownAmount: { fontSize: 14, fontWeight: '600', color: colors.text },
  // Same pill treatment as HomeScreen's Charts button -- fixed 56 height,
  // rounded ends via a radius half that height, horizontal padding instead
  // of a fixed width.
  backPill: {
    position: 'absolute',
    height: 56,
    paddingHorizontal: 20,
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
  backPillText: { color: colors.accentText, fontSize: 16, fontWeight: '600' },
});
