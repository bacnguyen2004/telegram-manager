from pathlib import Path

p = Path(__file__).resolve().parents[1] / "src" / "pages" / "dialogs" / "DialogsPage.tsx"
text = p.read_text(encoding="utf-8")

old_toggle = """
  function toggleMessageSelection(messageId: number) {
    setSelectedMessageIds((prev) => {
      const next = new Set(prev)
      if (next.has(messageId)) next.delete(messageId)
      else next.add(messageId)
      return next
    })
  }

"""
if old_toggle not in text:
    raise SystemExit("toggle not found")
text = text.replace(old_toggle, "\n", 1)
print("removed local toggle")

marker_start = '            <div className="dialogs-toolbar">'
marker_end = """            {filteredDialogs.length === 0 && (
              <div className="dialogs-empty">
                <p className="muted">Không có chat khớp bộ lọc.</p>
              </div>
            )}
"""
start = text.find(marker_start)
end = text.find(marker_end)
if start < 0 or end < 0:
    raise SystemExit(f"list markers not found start={start} end={end}")
end += len(marker_end)
replacement = """            <DialogListFilters
              search={search}
              unreadOnly={unreadOnly}
              filter={filter}
              filterCounts={filterCounts}
              unreadDialogCount={unreadDialogCount}
              onSearchChange={setSearch}
              onUnreadOnlyToggle={() => setUnreadOnly((value) => !value)}
              onFilterChange={setFilter}
            />
            <DialogListItems
              filteredDialogs={filteredDialogs}
              selectedId={selected?.id ?? null}
              onSelectDialog={(dialog) => void handleSelectDialog(dialog)}
            />
"""
text = text[:start] + replacement + text[end:]
print("replaced dialog list UI")

# Message thread body: from <div className="chat-body"> through closing of that div before selectMode bar
body_start = text.find('            <div className="chat-body">')
if body_start < 0:
    raise SystemExit("chat-body not found")
# end at MessageSelectionBar section
body_end_marker = "            {selected && selectMode ? ("
body_end = text.find(body_end_marker, body_start)
if body_end < 0:
    raise SystemExit("selection bar marker not found")

thread_jsx = """            <MessageThread
              phone={phone}
              peerId={selected?.id ?? ''}
              selected={Boolean(selected)}
              loadingMessages={loadingMessages}
              loadingOlder={loadingOlder}
              messagesEmpty={messages.length === 0}
              hasPinned={pinnedMessages.length > 0}
              selectMode={selectMode}
              messageSearch={messageSearch}
              displayedEmpty={displayedMessages.length === 0}
              chatTimeline={chatTimeline}
              messages={messages}
              reactionsPolicy={reactionsPolicy}
              reactingId={reactingId}
              sending={sending}
              deletingId={deletingId}
              pinningId={pinningId}
              forwarding={forwarding}
              canPinMessages={canPinMessages}
              loadedPhotoIds={loadedPhotoIds}
              loadedMediaIds={loadedMediaIds}
              selectedMessageIds={selectedMessageIds}
              showJumpBtn={showJumpBtn}
              pendingUnread={pendingUnread}
              messagesScrollRef={messagesScrollRef}
              loadOlderSentinelRef={loadOlderSentinelRef}
              messageRefs={messageRefs}
              onScroll={handleMessagesScroll}
              onJumpToLatest={handleJumpToLatest}
              onToggleSelect={toggleMessageSelection}
              onRevealPhoto={revealPhoto}
              onRevealMedia={revealMedia}
              onReact={(msg, emoji) => void handleSendReaction(msg, emoji)}
              onReply={handleReplyToMessage}
              onCopy={(msg) => void handleCopyMessage(msg)}
              onEdit={startEditMessage}
              onForward={setForwardMessage}
              onPin={(msg, unpin) => void handlePinMessage(msg, unpin)}
              onDelete={(msg) => void handleDeleteMessage(msg)}
              onContextMenu={openMessageMenu}
              onScrollToMessageId={scrollToMessageId}
              canEditMessage={canEditMessage}
              isAtBottom={isAtBottom}
              scrollToLatest={scrollToLatest}
            />

"""
text = text[:body_start] + thread_jsx + text[body_end:]
print("replaced message thread UI")

# Composer form
compose_start = text.find("            {selected && !selectMode && (")
if compose_start < 0:
    raise SystemExit("compose start not found")
# find the form block - ends before MediaGalleryModal
compose_end = text.find("      <MediaGalleryModal", compose_start)
if compose_end < 0:
    raise SystemExit("compose end not found")
# include the closing of selected && !selectMode
# look backwards from MediaGallery for the form close
compose_block_end = text.rfind("            )}", compose_start, compose_end)
if compose_block_end < 0:
    raise SystemExit("compose block end not found")
compose_block_end = text.find("\n", compose_block_end) + 1

compose_jsx = """            {selected && !selectMode && (
              <ComposerBar
                draftText={draftText}
                replyTo={replyTo}
                editingMessage={editingMessage}
                selectedMedia={selectedMedia}
                selectedMediaKind={selectedMediaKind}
                mediaPreview={mediaPreview}
                sending={sending}
                loadingMessages={loadingMessages}
                imageInputRef={imageInputRef}
                composeInputRef={composeInputRef}
                onDraftChange={setDraftText}
                onCancelReply={() => setReplyTo(null)}
                onCancelEdit={cancelEdit}
                onClearMedia={clearSelectedMedia}
                onMediaSelect={handleMediaSelect}
                onPaste={(e) => handleComposePaste(e)}
                onSubmit={(e) => void handleSendMessage(e)}
              />
            )}

"""
text = text[:compose_start] + compose_jsx + text[compose_block_end:]
print("replaced composer UI")

# Clean unused imports from page
for unused in [
    "import { MessageMediaBlock } from '../../components/MessageMediaBlock'\n",
    "import { MessagePollBlock } from '../../components/MessagePollBlock'\n",
    "import { MessageReactionBar } from '../../components/MessageReactionBar'\n",
    "import { MessageReplyQuote } from '../../components/MessageReplyQuote'\n",
    "import { MessageText } from '../../components/MessageText'\n",
]:
    text = text.replace(unused, "")

# avatar helpers may still be needed? dialog list moved - avatarHue used only in list
# mediaTypeLabel - only in thread
# resolveReplyQuote - only in thread
# formatFileSize, chat media - still used in handlers
# kindLabel kindBadgeClass - removed from page if only in list

# Remove unused utils if no longer referenced
if "avatarHue" not in text.split("from '../../utils/avatar'")[0] and "avatarHue" not in text[text.find("from '../../utils/avatar'"):]:
    pass

# Safer: leave imports; tsc unusedLocals may not fail

p.write_text(text, encoding="utf-8")
print("done, lines", text.count("\n") + 1)
