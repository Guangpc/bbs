import { StatusBar } from "expo-status-bar";
import {
  LiuJianMaoCao_400Regular,
  useFonts,
} from "@expo-google-fonts/liu-jian-mao-cao";
import * as SQLite from "expo-sqlite";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform as RNPlatform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { consumeManualShare } from "./src/consume/consumeInboxItem";
import {
  recordVideoOpen,
  setVideoPinned,
  softDeleteVideo,
  updateVideoComment,
} from "./src/db/repository";
import { listLiveVideos, migrateDatabase, type VideoRow } from "./src/db/schema";
import { syncInbox } from "./src/inbox/syncInbox";
import {
  enrichVideosMetadata,
  needsMetadataEnrichment,
} from "./src/metadata/enrichVideos";
import { openOriginalContent } from "./src/open/openOriginal";
import type { Platform } from "./src/parsers/share";
import { BrandTitle } from "./src/ui/BrandTitle";
import { formatCommentPreview } from "./src/ui/commentPreview";
import { displayTitle } from "./src/ui/displayTitle";

type PlatformFilter = Platform | null;

const PLATFORM_FILTERS: { key: Platform; label: string }[] = [
  { key: "xiaohongshu", label: "小红书" },
  { key: "bilibili", label: "B站" },
  { key: "douyin", label: "抖音" },
  { key: "kuaishou", label: "快手" },
  { key: "x", label: "X" },
];

const PLATFORM_LABEL: Record<string, string> = {
  douyin: "抖音",
  bilibili: "B站",
  xiaohongshu: "小红书",
  kuaishou: "快手",
  x: "X",
  unknown: "未知",
};

const PLATFORM_COLOR: Record<string, string> = {
  douyin: "#111111",
  bilibili: "#FB7299",
  xiaohongshu: "#FF2442",
  kuaishou: "#FF4906",
  x: "#1C1C1C",
  unknown: "#78716c",
};

export default function App() {
  const [fontsLoaded] = useFonts({
    LiuJianMaoCao_400Regular,
  });
  const [db, setDb] = useState<SQLite.SQLiteDatabase | null>(null);
  const [videos, setVideos] = useState<VideoRow[]>([]);
  const [pasteText, setPasteText] = useState("");
  const [status, setStatus] = useState("初始化中…");
  const [busy, setBusy] = useState(false);
  const [platformFilter, setPlatformFilter] = useState<PlatformFilter>(null);
  const [commentingVideo, setCommentingVideo] = useState<VideoRow | null>(null);
  const [draftComment, setDraftComment] = useState("");

  const refresh = useCallback(async (database: SQLite.SQLiteDatabase) => {
    const rows = await listLiveVideos(database);
    setVideos(rows);
  }, []);

  const runEnrich = useCallback(
    async (database: SQLite.SQLiteDatabase, videoIds?: string[]) => {
      const enrich = await enrichVideosMetadata(database, {
        videoIds,
        limit: videoIds?.length ?? 8,
      });
      if (enrich.attempted === 0) {
        return;
      }
      await refresh(database);
      if (enrich.updated > 0) {
        setStatus(
          `已补全文案 ${enrich.updated} 条` +
            (enrich.failed ? `，失败 ${enrich.failed}` : ""),
        );
      } else if (enrich.failed > 0) {
        setStatus(
          `文案获取失败（保持仅链接）：${enrich.errors[0] ?? "未知错误"}`,
        );
      }
    },
    [refresh],
  );

  const runSync = useCallback(
    async (database: SQLite.SQLiteDatabase) => {
      setBusy(true);
      try {
        const summary = await syncInbox(database);
        await refresh(database);
        setStatus(
          `同步完成：处理 ${summary.processed}，失败 ${summary.failed}` +
            (summary.errors[0] ? `（${summary.errors[0]}）` : ""),
        );
        await runEnrich(database);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error));
      } finally {
        setBusy(false);
      }
    },
    [refresh, runEnrich],
  );

  useEffect(() => {
    let active = true;

    (async () => {
      const database = await SQLite.openDatabaseAsync("video-bookmark-demo.db");
      await migrateDatabase(database);
      if (!active) {
        return;
      }
      setDb(database);
      await refresh(database);
      await runSync(database);
    })().catch((error) => {
      setStatus(error instanceof Error ? error.message : String(error));
    });

    return () => {
      active = false;
    };
  }, [refresh, runSync]);

  useEffect(() => {
    if (!db) {
      return;
    }

    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void runSync(db);
      }
    });

    return () => sub.remove();
  }, [db, runSync]);

  const onPasteSave = async () => {
    if (!db || !pasteText.trim()) {
      return;
    }
    setBusy(true);
    try {
      await consumeManualShare(pasteText.trim(), db);
      setPasteText("");
      await refresh(db);
      setStatus("已从粘贴内容保存");
      await runEnrich(db);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const onOpen = async (video: VideoRow) => {
    if (!db) return;
    try {
      await recordVideoOpen(db, video.id);
      await refresh(db);
      const opened = await openOriginalContent(video);
      const viaApp = !opened.startsWith("http");
      setStatus(viaApp ? "已在 App 中打开" : "已打开链接（网页）");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const openCommentEditor = (video: VideoRow) => {
    setCommentingVideo(video);
    setDraftComment(video.comment ?? "");
    setStatus(video.comment?.trim() ? "查看 / 编辑评论" : "写一条评论");
  };

  const closeCommentEditor = () => {
    setCommentingVideo(null);
    setDraftComment("");
  };

  const onSaveComment = async () => {
    if (!db || !commentingVideo) return;
    await updateVideoComment(db, commentingVideo.id, draftComment);
    await refresh(db);
    closeCommentEditor();
    setStatus(draftComment.trim() ? "评论已保存" : "评论已清空");
  };

  const onTogglePin = async (video: VideoRow) => {
    if (!db) return;
    const next = !(video.is_pinned === 1);
    await setVideoPinned(db, video.id, next);
    await refresh(db);
    setStatus(next ? "已手动置顶" : "已取消置顶");
  };

  const onDelete = async (video: VideoRow) => {
    if (!db) return;
    if (commentingVideo?.id === video.id) {
      closeCommentEditor();
    }
    await softDeleteVideo(db, video.id);
    await refresh(db);
    setStatus("已从收藏夹删除");
  };

  const onRefetchMeta = async (video: VideoRow) => {
    if (!db) return;
    setBusy(true);
    try {
      setStatus("正在获取文案…");
      await runEnrich(db, [video.id]);
    } finally {
      setBusy(false);
    }
  };

  const visible = useMemo(() => {
    if (!platformFilter) {
      return videos;
    }
    return videos.filter((v) => v.platform === platformFilter);
  }, [videos, platformFilter]);

  const commentingTitle = commentingVideo ? displayTitle(commentingVideo) : null;
  const commentingPlatformLabel = commentingVideo
    ? (PLATFORM_LABEL[commentingVideo.platform] ?? commentingVideo.platform)
    : "";
  const commentingPlatformColor = commentingVideo
    ? (PLATFORM_COLOR[commentingVideo.platform] ?? PLATFORM_COLOR.unknown)
    : PLATFORM_COLOR.unknown;

  return (
    <View style={styles.gradient}>
      {/* Soft sky-blue → lavender wash without native LinearGradient */}
      <View style={[styles.wash, styles.washSky]} />
      <View style={[styles.wash, styles.washLavender]} />
      <View style={[styles.wash, styles.washMist]} />
      <SafeAreaView style={styles.safe}>
        <StatusBar style="dark" />
        <View style={styles.header}>
          {fontsLoaded ? <BrandTitle /> : <Text style={styles.titleFallback}>不白刷</Text>}
          <Text style={styles.subtitle}>刷都刷了，那就让好内容不白刷。</Text>
          <Text style={styles.status}>{status}</Text>
        </View>

        <View style={styles.pasteBox}>
          <TextInput
            style={styles.input}
            multiline
            editable={!commentingVideo}
            placeholder="粘贴链接或分享文案（视频 / 笔记均可；分享入口不可用时的 fallback）"
            value={pasteText}
            onChangeText={setPasteText}
            placeholderTextColor="#94A3B8"
          />
          <View style={styles.row}>
            <Pressable
              style={styles.button}
              onPress={onPasteSave}
              disabled={busy || !!commentingVideo}
            >
              <Text style={styles.buttonText}>粘贴保存</Text>
            </Pressable>
            <Pressable
              style={[styles.button, styles.secondary]}
              onPress={() => db && runSync(db)}
              disabled={busy || !db || !!commentingVideo}
            >
              <Text style={styles.buttonText}>同步 Inbox</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.platformRow}>
          {PLATFORM_FILTERS.map(({ key, label }) => {
            const active = platformFilter === key;
            return (
              <Pressable
                key={key}
                style={[styles.platformChip, active && styles.platformChipActive]}
                onPress={() => setPlatformFilter((prev) => (prev === key ? null : key))}
              >
                <Text
                  allowFontScaling={false}
                  numberOfLines={1}
                  style={active ? styles.platformTextActive : styles.platformText}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {busy ? <ActivityIndicator style={styles.spinner} color="#6366F1" /> : null}

        <FlatList
          data={visible}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          removeClippedSubviews={false}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <Text style={styles.empty}>这个分类还没有收藏。分享或上方粘贴添加。</Text>
          }
          renderItem={({ item }) => {
            const platformLabel = PLATFORM_LABEL[item.platform] ?? item.platform;
            const platformColor = PLATFORM_COLOR[item.platform] ?? PLATFORM_COLOR.unknown;
            const watched = item.status === "watched";
            const pinned = item.is_pinned === 1;
            const title = displayTitle(item);
            const canRefetch =
              item.platform === "xiaohongshu" ||
              item.platform === "x" ||
              needsMetadataEnrichment(item);
            const preview = formatCommentPreview(item.comment);

            return (
              <View
                style={[
                  styles.card,
                  pinned && styles.cardPinned,
                  watched ? styles.cardWatched : styles.cardUnread,
                ]}
              >
                <View style={styles.cardHeader}>
                  <View style={styles.cardHeaderLeft}>
                    <View style={[styles.badge, { backgroundColor: platformColor }]}>
                      <Text allowFontScaling={false} style={styles.badgeText}>
                        {platformLabel}
                      </Text>
                    </View>
                    {pinned ? (
                      <Text allowFontScaling={false} style={styles.pinTag}>
                        置顶
                      </Text>
                    ) : null}
                  </View>
                  <View style={styles.cardHeaderRight}>
                    {preview ? (
                      <Pressable
                        style={styles.commentPreviewHit}
                        onPress={() => openCommentEditor(item)}
                      >
                        <Text style={styles.commentPreview} numberOfLines={1}>
                          {preview}
                        </Text>
                      </Pressable>
                    ) : null}
                    {watched ? (
                      <View style={styles.watchedDot} />
                    ) : (
                      <View style={styles.watchedDotPlaceholder} />
                    )}
                  </View>
                </View>

                <Pressable onPress={() => onOpen(item)}>
                  {title ? (
                    <Text
                      style={[styles.cardMeta, watched && styles.cardMetaWatched]}
                      numberOfLines={2}
                    >
                      {title}
                    </Text>
                  ) : (
                    <Text style={[styles.cardMetaMuted, watched && styles.cardMetaWatched]}>
                      无标题（仅链接）
                    </Text>
                  )}
                </Pressable>

                <View style={styles.actions}>
                  <Pressable style={styles.actionBtn} onPress={() => openCommentEditor(item)}>
                    <Text style={styles.actionText}>评论</Text>
                  </Pressable>
                  {canRefetch ? (
                    <Pressable style={styles.actionBtn} onPress={() => onRefetchMeta(item)}>
                      <Text style={styles.actionText}>重新获取</Text>
                    </Pressable>
                  ) : null}
                  <Pressable style={styles.actionBtn} onPress={() => onTogglePin(item)}>
                    <Text style={styles.actionText}>{pinned ? "取消置顶" : "置顶"}</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.actionBtn, styles.dangerBtn]}
                    onPress={() => onDelete(item)}
                  >
                    <Text style={[styles.actionText, styles.dangerText]}>删除</Text>
                  </Pressable>
                </View>
              </View>
            );
          }}
        />

        <Modal
          visible={!!commentingVideo}
          transparent
          animationType="fade"
          onRequestClose={closeCommentEditor}
        >
          <KeyboardAvoidingView
            style={styles.modalRoot}
            behavior={RNPlatform.OS === "ios" ? "padding" : undefined}
            keyboardVerticalOffset={12}
          >
            <Pressable style={styles.modalBackdrop} onPress={closeCommentEditor} />
            <View style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <View style={[styles.badge, { backgroundColor: commentingPlatformColor }]}>
                  <Text allowFontScaling={false} style={styles.badgeText}>
                    {commentingPlatformLabel}
                  </Text>
                </View>
                <Text style={styles.modalTitle} numberOfLines={2}>
                  {commentingTitle ?? "无标题（仅链接）"}
                </Text>
              </View>

              <Text style={styles.commentPanelLabel}>我的评论</Text>
              <TextInput
                style={styles.commentInput}
                multiline
                autoFocus
                placeholder="写点想法，保存在这条收藏下面…"
                placeholderTextColor="#94A3B8"
                value={draftComment}
                onChangeText={setDraftComment}
                textAlignVertical="top"
              />

              <View style={styles.commentActions}>
                <Pressable
                  style={[styles.commentActionBtn, styles.commentCancelBtn]}
                  onPress={closeCommentEditor}
                >
                  <Text style={styles.commentCancelText}>取消</Text>
                </Pressable>
                <Pressable
                  style={[styles.commentActionBtn, styles.commentSaveBtn]}
                  onPress={onSaveComment}
                >
                  <Text style={styles.commentSaveText}>保存</Text>
                </Pressable>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  gradient: { flex: 1, backgroundColor: "#EEF3FF" },
  wash: {
    ...StyleSheet.absoluteFill,
  },
  washSky: {
    backgroundColor: "#DCEBFF",
    opacity: 0.9,
  },
  washLavender: {
    top: "28%",
    backgroundColor: "#E9E0FF",
    opacity: 0.55,
  },
  washMist: {
    top: "62%",
    backgroundColor: "#F5F7FF",
    opacity: 0.85,
  },
  safe: { flex: 1, backgroundColor: "transparent" },
  header: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8, gap: 6 },
  titleFallback: {
    fontSize: 34,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: 2,
  },
  subtitle: { fontSize: 14, color: "#64748B", lineHeight: 20 },
  status: { fontSize: 12, color: "#94A3B8", marginTop: 2 },
  pasteBox: {
    paddingHorizontal: 20,
    paddingBottom: 8,
    gap: 8,
  },
  input: {
    minHeight: 72,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.35)",
    backgroundColor: "rgba(255, 255, 255, 0.88)",
    borderRadius: 16,
    padding: 12,
    fontSize: 14,
    color: "#1E293B",
  },
  row: { flexDirection: "row", gap: 8 },
  button: {
    flex: 1,
    backgroundColor: "#5B7CFA",
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: "center",
  },
  secondary: { backgroundColor: "#8B7CF6" },
  buttonText: { color: "#fff", fontWeight: "600" },
  platformRow: {
    paddingHorizontal: 16,
    paddingBottom: 10,
    gap: 8,
    flexDirection: "row",
    flexWrap: "wrap",
  },
  platformChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: "rgba(255, 255, 255, 0.72)",
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.25)",
  },
  platformChipActive: {
    backgroundColor: "#5B7CFA",
    borderColor: "#5B7CFA",
  },
  platformText: { fontSize: 13, color: "#475569", fontWeight: "600" },
  platformTextActive: { fontSize: 13, color: "#ffffff", fontWeight: "600" },
  spinner: { marginVertical: 8 },
  list: { paddingHorizontal: 20, paddingBottom: 40, gap: 10 },
  empty: { color: "#94A3B8", textAlign: "center", marginTop: 40 },
  card: {
    backgroundColor: "rgba(255, 255, 255, 0.92)",
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(226, 232, 240, 0.9)",
    gap: 6,
    shadowColor: "#94A3B8",
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  cardPinned: { borderColor: "#8B7CF6", borderWidth: 1.5 },
  cardUnread: { opacity: 1 },
  cardWatched: { opacity: 0.9 },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  cardHeaderLeft: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0 },
  cardHeaderRight: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 6,
    minWidth: 0,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  badgeText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  pinTag: { fontSize: 12, color: "#7C6BF0", fontWeight: "700" },
  watchedDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#60A5FA",
    flexShrink: 0,
  },
  watchedDotPlaceholder: {
    width: 10,
    height: 10,
    flexShrink: 0,
  },
  commentPreviewHit: {
    flexShrink: 1,
    maxWidth: "100%",
  },
  commentPreview: {
    fontSize: 11,
    lineHeight: 15,
    color: "#94A3B8",
    fontWeight: "400",
    textAlign: "right",
  },
  cardMeta: { fontSize: 16, color: "#1E293B", lineHeight: 22, fontWeight: "600" },
  cardMetaWatched: { color: "#64748B", fontWeight: "500" },
  cardMetaMuted: { fontSize: 13, color: "#94A3B8" },
  actions: { flexDirection: "row", gap: 8, marginTop: 4 },
  actionBtn: {
    flex: 1,
    backgroundColor: "rgba(241, 245, 249, 0.95)",
    paddingVertical: 8,
    borderRadius: 10,
    alignItems: "center",
  },
  dangerBtn: { backgroundColor: "#FEF2F2" },
  actionText: { fontSize: 13, fontWeight: "600", color: "#334155" },
  dangerText: { color: "#DC2626" },
  modalRoot: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(30, 41, 59, 0.4)",
  },
  modalCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 16,
    gap: 10,
    zIndex: 2,
    shadowColor: "#64748B",
    shadowOpacity: 0.2,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  modalHeader: {
    gap: 8,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1E293B",
    lineHeight: 22,
  },
  commentPanelLabel: {
    fontSize: 12,
    color: "#64748B",
    fontWeight: "600",
  },
  commentInput: {
    minHeight: 120,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.35)",
    backgroundColor: "#F8FAFC",
    borderRadius: 14,
    padding: 12,
    fontSize: 15,
    color: "#1E293B",
    lineHeight: 22,
  },
  commentActions: {
    flexDirection: "row",
    gap: 8,
  },
  commentActionBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  commentCancelBtn: { backgroundColor: "#F1F5F9" },
  commentSaveBtn: { backgroundColor: "#5B7CFA" },
  commentCancelText: { fontSize: 14, fontWeight: "600", color: "#475569" },
  commentSaveText: { fontSize: 14, fontWeight: "600", color: "#fff" },
});
