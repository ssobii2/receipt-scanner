// Manual entry / edit form for a single receipt. A freshly captured photo
// (not one already attached to an existing receipt) is sent to OpenAI for a
// prefill; the user always confirms before saving.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  Image,
  ScrollView,
  StyleSheet,
  Modal,
  FlatList,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import DateTimePicker, { type DateTimePickerChangeEvent } from '@react-native-community/datetimepicker';
import { Picker } from '@react-native-picker/picker';
import { addReceipt, updateReceipt, deleteReceipt, type ReceiptRow, type NewReceipt } from '../db';
import { deleteImage } from '../lib/images';
import { parseAmountToMinor, isoMinorDigits } from '../lib/money';
import { todayISO, normalizeSpentOn } from '../lib/dates';
import { merchantKey } from '../lib/merchant';
import { CATEGORIES, type Category } from '../lib/category';
import { MAJOR_CURRENCIES } from '../lib/currencies';
import { extractReceiptFromPhoto } from '../lib/extractReceiptLive';
import type { ExtractResult } from '../lib/openai';
import { colors } from '../theme';

type ExtractFailure = Extract<ExtractResult, { ok: false }>;

/** Non-technical, action-oriented copy for each failure reason. Never prints
 * the reason code or an HTTP status -- those mean nothing to the user typing
 * a receipt in by hand a second later. */
function extractionErrorMessage(failure: ExtractFailure): string {
  switch (failure.reason) {
    case 'offline':
      return "No internet connection right now. You can type the details in, or retry once you're back online.";
    case 'rate-limited':
      return failure.retryAfterSeconds
        ? `The free scanning limit was reached. Try again in about ${failure.retryAfterSeconds} seconds, or type the details in.`
        : 'The free scanning limit was reached for now. Try again in a bit, or type the details in.';
    case 'malformed':
      return "Couldn't read this photo clearly. You can retry, or type the details in.";
    case 'no-key':
      return 'Receipt scanning is not set up yet. Type the details in for now.';
    case 'no-credit':
      return 'The OpenAI account has no credit left, so receipt scanning is unavailable. Type the details in for now.';
    case 'http':
    default:
      return "Something went wrong reading the receipt. You can retry, or type the details in.";
  }
}

const MIN_DATE = new Date(2000, 0, 1);

// iOS-only bottom sheet shared by the date and currency wheels: a themed
// panel anchored to the bottom with a Cancel/Done header. Android never
// renders this -- it keeps its own native dialog / FlatList modal.
type WheelSheetProps = {
  visible: boolean;
  onCancel: () => void;
  onDone: () => void;
  children: ReactNode;
};

function WheelSheet({ visible, onCancel, onDone, children }: WheelSheetProps) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onCancel}>
      <View style={styles.sheetBackdrop}>
        <View style={styles.sheetPanel}>
          <View style={styles.sheetHeader}>
            <Pressable onPress={onCancel}>
              <Text style={styles.sheetHeaderAction}>Cancel</Text>
            </Pressable>
            <Pressable onPress={onDone}>
              <Text style={[styles.sheetHeaderAction, styles.sheetHeaderDone]}>Done</Text>
            </Pressable>
          </View>
          {children}
        </View>
      </View>
    </Modal>
  );
}

// Presentation-only inverse of parseAmountToMinor, for seeding the editable
// text field from a stored integer when editing. Mirrors formatMoney's raw
// digit-string approach (no float math) but without Intl grouping/symbols,
// since this is going into a plain decimal-pad TextInput, not a label.
function minorToInputString(minor: number, currency: string): string {
  const digits = isoMinorDigits(currency);
  if (digits === 0) return String(minor);
  const s = Math.abs(minor).toString().padStart(digits + 1, '0');
  return `${minor < 0 ? '-' : ''}${s.slice(0, -digits)}.${s.slice(-digits)}`;
}

type Props = {
  receipt?: ReceiptRow;
  imageUri?: string;
  onDone: () => void;
  onCapture: () => void;
};

export default function EntryScreen({ receipt, imageUri, onDone, onCapture }: Props) {
  const [merchant, setMerchant] = useState(receipt?.merchant ?? '');
  const [amount, setAmount] = useState(
    receipt ? minorToInputString(receipt.amount_minor, receipt.currency) : '',
  );
  const [currency, setCurrency] = useState(receipt?.currency ?? 'PKR');
  const [date, setDate] = useState(receipt?.spent_on ?? todayISO());
  const [category, setCategory] = useState<Category | null>(
    (receipt?.category as Category | undefined) ?? null,
  );
  const [image, setImage] = useState<string | null>(imageUri ?? receipt?.image_path ?? null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [showCurrencyPicker, setShowCurrencyPicker] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  // iOS wheels fire onValueChange continuously while scrolling (unlike
  // Android's one-shot dialog), so `date`/`currency` are already mutated by
  // the time the user taps Cancel. These snapshot the value the sheet
  // opened with, so Cancel can restore it instead of keeping whatever the
  // wheel had scrolled past.
  const [dateAtOpen, setDateAtOpen] = useState(date);
  const [currencyAtOpen, setCurrencyAtOpen] = useState(currency);

  const [touched, setTouched] = useState({
    merchant: false,
    amount: false,
    date: false,
    category: false,
  });
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const showError = (field: keyof typeof touched) => submitAttempted || touched[field];
  const markTouched = (field: keyof typeof touched) =>
    setTouched((t) => (t[field] ? t : { ...t, [field]: true }));

  // Whether the user has changed each field since mount, checked at the
  // moment extraction resolves so a prefill never clobbers what they already
  // typed or picked. A ref (not state) because it must read as up-to-date
  // inside an async callback without retriggering the extraction effect.
  const userEdited = useRef({ merchant: false, amount: false, currency: false, date: false, category: false });

  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<ExtractFailure | null>(null);
  // Guards against re-extracting the same photo on every re-render; the
  // Retry button bypasses this by calling runExtraction directly.
  const extractedUriRef = useRef<string | null>(null);

  async function runExtraction(targetUri: string) {
    setExtracting(true);
    setExtractError(null);
    const result = await extractReceiptFromPhoto(targetUri);
    setExtracting(false);

    if (!result.ok) {
      setExtractError(result);
      return;
    }

    const e = result.extraction;
    if (e.merchant !== null && !userEdited.current.merchant) setMerchant(e.merchant);
    if (e.spentOn !== null && !userEdited.current.date) setDate(e.spentOn);
    if (e.category !== null && !userEdited.current.category) setCategory(e.category);

    // Currency and amount are applied together: the picker is a closed list,
    // so a currency outside it can't be shown, and pairing the amount with
    // whatever currency is already selected would misrepresent the receipt.
    const currencyShowable = e.currency !== null && MAJOR_CURRENCIES.some((c) => c.code === e.currency);
    if (currencyShowable && e.amountMinor !== null) {
      if (!userEdited.current.currency) setCurrency(e.currency as string);
      if (!userEdited.current.amount) setAmount(minorToInputString(e.amountMinor, e.currency as string));
    } else if (e.amountMinor === null && e.totalValueRaw !== null && !userEdited.current.amount) {
      // No currency was read off the receipt (a bare number, no symbol or
      // code), so amountMinor is unscored -- but the digits are still good.
      // Pair them with whatever currency is already selected in the form
      // (PKR by default) rather than discarding a correct total; leave the
      // currency picker alone so the user chooses it themselves.
      const fallbackMinor = parseAmountToMinor(e.totalValueRaw, currency);
      if (fallbackMinor !== null) setAmount(minorToInputString(fallbackMinor, currency));
    }
  }

  // Only a freshly captured photo on a brand-new receipt triggers extraction.
  // An existing receipt already has confirmed values -- re-reading its photo
  // could silently overwrite a correction the user made, which is exactly
  // what slice 5's category learning depends on not happening.
  useEffect(() => {
    if (receipt || !imageUri) return;
    if (extractedUriRef.current === imageUri) return;
    extractedUriRef.current = imageUri;
    void runExtraction(imageUri);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receipt, imageUri]);

  const merchantValid = merchantKey(merchant) !== null;
  // Currency now comes from a fixed picker list, so it can never be invalid.
  const amountMinor = useMemo(
    () => parseAmountToMinor(amount, currency),
    [amount, currency],
  );
  const amountValid = amountMinor !== null;
  const normalizedDate = useMemo(() => normalizeSpentOn(date, todayISO()), [date]);
  const dateValid = normalizedDate !== null;
  const categoryValid = category !== null;
  const canSave = merchantValid && amountValid && dateValid && categoryValid && !saving;

  async function handleSave() {
    if (!canSave || amountMinor === null || normalizedDate === null || category === null) {
      setSubmitAttempted(true);
      return;
    }
    const key = merchantKey(merchant);
    if (key === null) return;

    setSaving(true);
    setError(null);
    try {
      const payload: NewReceipt = {
        merchant: merchant.trim(),
        merchant_key: key,
        amount_minor: amountMinor,
        currency,
        spent_on: normalizedDate,
        category,
        image_path: image,
        total_source_text: receipt?.total_source_text ?? null,
      };
      if (receipt) {
        await updateReceipt(receipt.id, payload);
      } else {
        await addReceipt(payload);
      }
      onDone();
    } catch (e) {
      setError(`Failed to save: ${String(e)}`);
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!receipt) return;
    if (!deleteArmed) {
      setDeleteArmed(true);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await deleteReceipt(receipt.id);
      if (receipt.image_path) await deleteImage(receipt.image_path);
      onDone();
    } catch (e) {
      setError(`Failed to delete: ${String(e)}`);
      setSaving(false);
      setDeleteArmed(false);
    }
  }

  // Android's picker is a one-shot dialog: it must come off screen as soon as
  // it fires, whether the user picked a date or dismissed it, or it
  // reopens itself. iOS renders inline and stays mounted until "Done".
  // Either way, todayISO() (local Y/M/D) is used to read the picker's Date --
  // never toISOString(), which shifts the day back for UTC+5 users.
  function handleDateChange(_event: DateTimePickerChangeEvent, selected: Date) {
    if (Platform.OS === 'android') setShowDatePicker(false);
    setDate(todayISO(selected));
    userEdited.current.date = true;
    markTouched('date');
  }

  function handleDateDismiss() {
    if (Platform.OS === 'android') setShowDatePicker(false);
  }

  function openDatePicker() {
    setDateAtOpen(date);
    setShowDatePicker(true);
  }

  function handleDateCancel() {
    setDate(dateAtOpen);
    setShowDatePicker(false);
  }

  function handleDateDone() {
    setShowDatePicker(false);
  }

  function openCurrencyPicker() {
    setCurrencyAtOpen(currency);
    setShowCurrencyPicker(true);
  }

  function handleCurrencyCancel() {
    setCurrency(currencyAtOpen);
    setShowCurrencyPicker(false);
  }

  function handleCurrencyDone() {
    setShowCurrencyPicker(false);
  }

  async function handleRemovePhoto() {
    if (!image) return;
    try {
      await deleteImage(image);
      setImage(null);
    } catch (e) {
      setError(`Failed to remove photo: ${String(e)}`);
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>{receipt ? 'Edit receipt' : 'Add receipt'}</Text>

        {extracting && (
          <View style={styles.extractRow}>
            <ActivityIndicator color={colors.textMuted} />
            <Text style={styles.extractText}>Reading receipt…</Text>
          </View>
        )}

        {extractError && (
          <View style={styles.extractErrorBox}>
            <Text style={styles.extractErrorText}>{extractionErrorMessage(extractError)}</Text>
            <View style={styles.extractErrorActions}>
              {extractError.reason !== 'no-key' && extractError.reason !== 'no-credit' && imageUri && (
                <Pressable onPress={() => void runExtraction(imageUri)}>
                  <Text style={styles.extractErrorAction}>Retry</Text>
                </Pressable>
              )}
              <Pressable onPress={() => setExtractError(null)}>
                <Text style={styles.extractErrorAction}>Dismiss</Text>
              </Pressable>
            </View>
          </View>
        )}

        <Text style={styles.label}>Merchant</Text>
        <TextInput
          style={styles.input}
          value={merchant}
          onChangeText={(v) => {
            userEdited.current.merchant = true;
            setMerchant(v);
          }}
          onBlur={() => markTouched('merchant')}
          placeholder="e.g. Imtiaz Super Market"
          placeholderTextColor={colors.textFaint}
          autoCapitalize="words"
        />
        {!merchantValid && showError('merchant') && (
          <Text style={styles.fieldError}>Enter a merchant name.</Text>
        )}

        <View style={styles.rowFields}>
          <View style={styles.flex1}>
            <Text style={styles.label}>Amount</Text>
            <TextInput
              style={styles.input}
              value={amount}
              onChangeText={(v) => {
                userEdited.current.amount = true;
                setAmount(v);
              }}
              onBlur={() => markTouched('amount')}
              placeholder="0.00"
              placeholderTextColor={colors.textFaint}
              keyboardType="decimal-pad"
            />
            <Text style={styles.hint}>{isoMinorDigits(currency)} decimals</Text>
            {!amountValid && showError('amount') && (
              <Text style={styles.fieldError}>Enter a positive amount.</Text>
            )}
          </View>
          <View style={styles.currencyField}>
            <Text style={styles.label}>Currency</Text>
            <Pressable style={styles.input} onPress={openCurrencyPicker}>
              <Text style={styles.pickerValueText}>{currency}</Text>
            </Pressable>
          </View>
        </View>

        <Text style={styles.label}>Date</Text>
        <Pressable style={styles.input} onPress={openDatePicker}>
          <Text style={styles.pickerValueText}>{date}</Text>
        </Pressable>
        {!dateValid && showError('date') && (
          <Text style={styles.fieldError}>Enter a valid date, not in the future.</Text>
        )}
        {Platform.OS === 'android' && showDatePicker && (
          <DateTimePicker
            value={normalizedDate ? new Date(date + 'T00:00:00') : new Date()}
            mode="date"
            maximumDate={new Date()}
            minimumDate={MIN_DATE}
            display="default"
            themeVariant="dark"
            accentColor={colors.accent}
            onValueChange={handleDateChange}
            onDismiss={handleDateDismiss}
          />
        )}
        {Platform.OS === 'ios' && (
          <WheelSheet visible={showDatePicker} onCancel={handleDateCancel} onDone={handleDateDone}>
            <DateTimePicker
              value={normalizedDate ? new Date(date + 'T00:00:00') : new Date()}
              mode="date"
              maximumDate={new Date()}
              minimumDate={MIN_DATE}
              display="spinner"
              themeVariant="dark"
              accentColor={colors.accent}
              onValueChange={handleDateChange}
            />
          </WheelSheet>
        )}

        <Text style={styles.label}>Category</Text>
        <View style={styles.categoryRow}>
          {CATEGORIES.map((c) => (
            <Pressable
              key={c}
              style={[styles.categoryButton, category === c && styles.categoryButtonSelected]}
              onPress={() => {
                userEdited.current.category = true;
                setCategory(c);
                markTouched('category');
              }}
            >
              <Text style={[styles.categoryText, category === c && styles.categoryTextSelected]}>
                {c}
              </Text>
            </Pressable>
          ))}
        </View>
        {!categoryValid && showError('category') && (
          <Text style={styles.fieldError}>Pick a category.</Text>
        )}

        <Text style={styles.label}>Photo</Text>
        {image ? (
          <View style={styles.photoBlock}>
            <Image source={{ uri: image }} style={styles.thumbnail} resizeMode="cover" />
            <Pressable style={styles.secondaryButton} onPress={handleRemovePhoto}>
              <Text style={styles.secondaryButtonText}>Remove photo</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable style={styles.secondaryButton} onPress={onCapture}>
            <Text style={styles.secondaryButtonText}>Add photo</Text>
          </Pressable>
        )}

        {error && <Text style={styles.error}>{error}</Text>}

        <Pressable
          style={[styles.saveButton, !canSave && styles.saveButtonDisabled]}
          onPress={handleSave}
          disabled={saving}
        >
          <Text style={styles.saveButtonText}>Save</Text>
        </Pressable>

        {receipt && (
          <Pressable style={styles.deleteButton} onPress={handleDelete} disabled={saving}>
            <Text style={styles.deleteButtonText}>
              {deleteArmed ? 'Tap again to delete' : 'Delete'}
            </Text>
          </Pressable>
        )}

        <Pressable style={styles.cancelLink} onPress={onDone}>
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
      </ScrollView>

      {Platform.OS === 'ios' ? (
        <WheelSheet
          visible={showCurrencyPicker}
          onCancel={handleCurrencyCancel}
          onDone={handleCurrencyDone}
        >
          <Picker
            selectedValue={currency}
            onValueChange={(itemValue) => {
              userEdited.current.currency = true;
              setCurrency(String(itemValue));
            }}
            itemStyle={styles.pickerItemText}
          >
            {MAJOR_CURRENCIES.map((c) => (
              <Picker.Item key={c.code} label={`${c.code} — ${c.name}`} value={c.code} />
            ))}
          </Picker>
        </WheelSheet>
      ) : (
        <Modal
          visible={showCurrencyPicker}
          animationType="slide"
          transparent
          onRequestClose={() => setShowCurrencyPicker(false)}
        >
          <Pressable style={styles.modalBackdrop} onPress={() => setShowCurrencyPicker(false)}>
            <View style={styles.modalSheet}>
              <FlatList
                data={MAJOR_CURRENCIES}
                keyExtractor={(item) => item.code}
                renderItem={({ item }) => (
                  <Pressable
                    style={styles.currencyRow}
                    onPress={() => {
                      userEdited.current.currency = true;
                      setCurrency(item.code);
                      setShowCurrencyPicker(false);
                    }}
                  >
                    <Text style={styles.currencyRowCode}>{item.code}</Text>
                    <Text style={styles.currencyRowName}>{item.name}</Text>
                  </Pressable>
                )}
              />
            </View>
          </Pressable>
        </Modal>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scrollContent: { padding: 16, paddingBottom: 48 },
  title: { fontSize: 22, fontWeight: '700', marginBottom: 16, color: colors.text },
  label: { fontSize: 13, fontWeight: '600', color: colors.textMuted, marginTop: 12, marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.text,
  },
  pickerValueText: { fontSize: 16, color: colors.text },
  hint: { fontSize: 12, color: colors.textMuted, marginTop: 4 },
  fieldError: { color: colors.danger, fontSize: 13, marginTop: 4 },
  extractRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  extractText: { color: colors.textMuted, fontSize: 14 },
  extractErrorBox: {
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    gap: 8,
  },
  extractErrorText: { color: colors.text, fontSize: 14 },
  extractErrorActions: { flexDirection: 'row', gap: 20 },
  extractErrorAction: { color: colors.danger, fontSize: 14, fontWeight: '600' },
  rowFields: { flexDirection: 'row', gap: 12 },
  flex1: { flex: 1 },
  currencyField: { width: 90 },
  categoryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  categoryButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  categoryButtonSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  categoryText: { fontSize: 14, color: colors.text },
  categoryTextSelected: { color: colors.accentText, fontWeight: '600' },
  photoBlock: { gap: 8, alignItems: 'flex-start' },
  thumbnail: { width: 120, height: 120, borderRadius: 8, backgroundColor: colors.surface },
  secondaryButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignSelf: 'flex-start',
  },
  secondaryButtonText: { color: colors.text, fontSize: 15, fontWeight: '500' },
  error: { color: colors.danger, marginTop: 16, fontSize: 14 },
  saveButton: {
    backgroundColor: colors.accent,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 24,
  },
  saveButtonDisabled: { backgroundColor: colors.disabled },
  saveButtonText: { color: colors.accentText, fontSize: 16, fontWeight: '700' },
  deleteButton: { alignItems: 'center', paddingVertical: 14, marginTop: 8 },
  deleteButtonText: { color: colors.danger, fontSize: 15, fontWeight: '600' },
  cancelLink: { alignItems: 'center', paddingVertical: 12 },
  cancelText: { color: colors.textMuted, fontSize: 15 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '70%',
    paddingVertical: 8,
  },
  currencyRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 10,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  currencyRowCode: { fontSize: 16, fontWeight: '700', color: colors.text, width: 44 },
  currencyRowName: { fontSize: 15, color: colors.textMuted },
  sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  sheetPanel: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 24,
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  sheetHeaderAction: { fontSize: 16, color: colors.textMuted },
  sheetHeaderDone: { color: colors.accent, fontWeight: '700' },
  pickerItemText: { color: colors.text },
});
