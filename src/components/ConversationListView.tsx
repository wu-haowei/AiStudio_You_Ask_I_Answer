import React, { useEffect, useState } from 'react';
import { MessageSquare, UserRound, Send, Check, X, RefreshCw, Search } from 'lucide-react';
import {
  ChatInvite,
  PRESENCE_HEARTBEAT_MS,
  PresenceRecord,
  announcePresence,
  dismissInvite,
  ensurePairRoom,
  listMyRooms,
  PairRoomSummary,
  partnerOf,
  respondToInvite,
  sameName,
  sendChatInvite,
  subscribeToInvites,
  subscribeToPresence,
} from '../lib/pairing';
import { useT } from '../i18n';

interface ConversationListViewProps {
  me: string;
  onOpenRoom: (roomId: string, partner: string) => void;
  showToast: (
    title: string,
    description?: string,
    type?: 'success' | 'error' | 'info' | 'warning'
  ) => void;
}

/**
 * Picks who to talk to.
 *
 * The presence listener lives here and nowhere else: every heartbeat from every
 * online person is a read for everyone watching, so it is attached when this
 * screen mounts and dropped the moment a room opens.
 */
export const ConversationListView: React.FC<ConversationListViewProps> = ({
  me,
  onOpenRoom,
  showToast,
}) => {
  const t = useT();
  const [rooms, setRooms] = useState<PairRoomSummary[]>([]);
  const [people, setPeople] = useState<PresenceRecord[]>([]);
  const [incoming, setIncoming] = useState<ChatInvite[]>([]);
  const [outgoing, setOutgoing] = useState<ChatInvite[]>([]);
  const [busyWith, setBusyWith] = useState('');
  // Narrowing the conversation list: filters as you type, no submit button
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'online' | 'offline'>('all');
  const [isLoading, setIsLoading] = useState(true);

  const refreshRooms = async () => {
    setRooms(await listMyRooms(me));
    setIsLoading(false);
  };

  useEffect(() => {
    refreshRooms();
  }, [me]);

  // Presence: announce myself, and watch the others — only while on this screen
  useEffect(() => {
    if (!me) return;

    announcePresence(me);
    const beat = setInterval(() => {
      if (document.visibilityState === 'visible') announcePresence(me);
    }, PRESENCE_HEARTBEAT_MS);

    const unsubscribe = subscribeToPresence(setPeople);
    return () => {
      clearInterval(beat);
      unsubscribe();
    };
  }, [me]);

  useEffect(() => {
    if (!me) return;
    return subscribeToInvites(me, (received, sent) => {
      setIncoming(received.filter((i) => i.status === 'pending'));
      setOutgoing(sent);
    });
  }, [me]);

  /* An invitation I sent was accepted — open the room and tidy the record. */
  useEffect(() => {
    const accepted = outgoing.find((i) => i.status === 'accepted');
    if (!accepted) return;

    (async () => {
      const roomId = await ensurePairRoom(me, accepted.to);
      await dismissInvite(accepted.id);
      showToast(t('convo.accepted'), t('convo.acceptedBody', { name: accepted.to }), 'success');
      onOpenRoom(roomId, accepted.to);
    })();
  }, [outgoing, me]);

  const declined = outgoing.find((i) => i.status === 'declined');
  useEffect(() => {
    if (!declined) return;
    showToast(t('convo.declined'), declined.to, 'info');
    dismissInvite(declined.id);
  }, [declined]);

  const handleInvite = async (target: string) => {
    if (busyWith) return;
    setBusyWith(target);
    try {
      await sendChatInvite(me, target);
      showToast(t('convo.inviteSent'), t('convo.waitingFor', { name: target }), 'info');
    } catch (err: any) {
      showToast(t('convo.inviteFailed'), err?.message || t('app.tryLater'), 'error');
    } finally {
      setBusyWith('');
    }
  };

  const handleRespond = async (invite: ChatInvite, accept: boolean) => {
    await respondToInvite(invite, accept);
    if (!accept) return;

    const roomId = await ensurePairRoom(me, invite.from);
    await refreshRooms();
    onOpenRoom(roomId, invite.from);
  };

  // Anyone already in a conversation with me does not need an invite button
  const existingPartners = rooms.map((r) => partnerOf(r.participants, me));
  const invitable = people.filter(
    (p) => !sameName(p.name, me) && !existingPartners.some((partner) => sameName(partner, p.name))
  );

  const card = 'rounded-2xl border border-[#D9C5B2] bg-white';

  /** Online people first, then by name within each group; filtered by the search box and the status select. */
  const visibleRooms = rooms
    .map((room) => {
      const partner = partnerOf(room.participants, me);
      return { room, partner, online: people.some((p) => sameName(p.name, partner)) };
    })
    .filter(({ partner, online }) => {
      if (statusFilter === 'online' && !online) return false;
      if (statusFilter === 'offline' && online) return false;
      const needle = query.trim().toLowerCase();
      return !needle || partner.toLowerCase().includes(needle);
    })
    .sort(
      (a, b) =>
        Number(b.online) - Number(a.online) ||
        a.partner.localeCompare(b.partner, undefined, { sensitivity: 'base', numeric: true })
    );

  /*
   * The list is capped in width: it is a short column of names, and letting it
   * run the full width of a desktop monitor strands the buttons at the far
   * edge. Phones are narrower than the cap, so nothing changes there.
   */
  return (
    <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pb-4 animate-fade-in w-full max-w-xl mx-auto">
      {/* Invitations addressed to me come first — they are time-sensitive */}
      {incoming.map((invite) => (
        /*
         * White card like the rest of the list, with a solid accent rail.
         * The old beige fill sat a hair away from the page colour, so the
         * card that most needs to be noticed was the hardest one to see.
         */
        <div
          key={invite.id}
          className={`${card} p-4 border-l-4 border-l-[#8E7256] space-y-3 shadow-sm`}
        >
          <div className="flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-2xl bg-[#8E7256] text-white flex items-center justify-center shrink-0">
              <MessageSquare className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-bold text-[#4A3F35] truncate">
                {t('convo.wantsToChat', { name: invite.from })}
              </p>
              <p className="text-[11px] text-[#7A6C5E]">{t('convo.acceptHint')}</p>
            </div>
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => handleRespond(invite, false)}
              className="px-4 py-2 rounded-xl border border-[#D9C5B2] bg-white text-[#7A6C5E] text-xs font-bold hover:bg-[#F5EFE6] transition-colors cursor-pointer inline-flex items-center gap-1.5"
            >
              <X className="w-3.5 h-3.5" />
              {t('convo.decline')}
            </button>
            {/* Full width on a phone, sized to its label on anything wider */}
            <button
              type="button"
              onClick={() => handleRespond(invite, true)}
              className="flex-1 sm:flex-none sm:px-6 milk-tea-btn-primary py-2 rounded-xl text-xs font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Check className="w-3.5 h-3.5" />
              {t('convo.accept')}
            </button>
          </div>
        </div>
      ))}

      <section className="space-y-2">
        <h2 className="text-xs font-bold text-[#7A6C5E] px-1">{t('convo.myChats')}</h2>

        {!isLoading && rooms.length > 0 && (
          <div className="flex items-center gap-2">
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#A69684]" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('convo.search')}
                aria-label={t('convo.search')}
                className="w-full pl-9 pr-3 py-2.5 text-sm rounded-xl milk-tea-input"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'all' | 'online' | 'offline')}
              aria-label={t('convo.filterAll')}
              className="shrink-0 px-3 py-2.5 text-sm rounded-xl milk-tea-input"
            >
              <option value="all">{t('convo.filterAll')}</option>
              <option value="online">{t('convo.online')}</option>
              <option value="offline">{t('convo.offline')}</option>
            </select>
          </div>
        )}

        {isLoading ? (
          <div className={`${card} p-6 flex items-center justify-center gap-2 text-xs text-[#7A6C5E]`}>
            <RefreshCw className="w-4 h-4 animate-spin" />
            {t('convo.loading')}
          </div>
        ) : rooms.length === 0 ? (
          <div className={`${card} p-6 text-center text-xs text-[#A69684]`}>
            {t('convo.empty')}
          </div>
        ) : visibleRooms.length === 0 ? (
          <div className={`${card} p-6 text-center text-xs text-[#A69684]`}>{t('convo.noMatch')}</div>
        ) : (
          visibleRooms.map(({ room, partner, online }) => {
            return (
              <button
                key={room.id}
                type="button"
                onClick={() => onOpenRoom(room.id, partner)}
                className={`w-full p-4 flex items-center gap-3 transition-colors text-left cursor-pointer rounded-2xl border ${
                  online
                    ? 'border-emerald-300 bg-emerald-50/70 hover:border-emerald-400'
                    : 'border-[#D9C5B2] bg-white hover:border-[#A68B6D]'
                }`}
              >
                <div
                  className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${
                    online ? 'bg-emerald-100 text-emerald-700' : 'bg-[#E8D8C4] text-[#5C4B3A]'
                  }`}
                >
                  <MessageSquare className="w-5 h-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold text-[#4A3F35] truncate">{partner}</div>
                  <div className={`text-[11px] ${online ? 'font-bold text-emerald-700' : 'text-[#7A6C5E]'}`}>
                    {online ? t('convo.online') : t('convo.offline')}
                  </div>
                </div>
                {online ? (
                  <span className="relative flex w-2.5 h-2.5 shrink-0">
                    <span className="absolute inline-flex w-full h-full rounded-full bg-emerald-400 opacity-60 animate-ping" />
                    <span className="relative inline-flex w-2.5 h-2.5 rounded-full bg-emerald-500" />
                  </span>
                ) : (
                  <span className="w-2 h-2 rounded-full shrink-0 bg-[#D9C5B2]" />
                )}
              </button>
            );
          })
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-xs font-bold text-[#7A6C5E] px-1">{t('convo.onlineNow')}</h2>

        {invitable.length === 0 ? (
          <div className={`${card} p-6 text-center text-xs text-[#A69684]`}>
            {t('convo.nobodyOnline')}
          </div>
        ) : (
          invitable.map((person) => {
            const pending = outgoing.some(
              (i) => i.to === person.name && i.status === 'pending'
            );
            return (
              <div key={person.name} className={`${card} p-4 flex items-center gap-3`}>
                <div className="w-10 h-10 rounded-2xl bg-[#E8D8C4] text-[#5C4B3A] flex items-center justify-center shrink-0">
                  <UserRound className="w-5 h-5" />
                </div>
                <span className="flex-1 min-w-0 text-sm font-bold text-[#4A3F35] truncate">
                  {person.name}
                </span>
                <button
                  type="button"
                  onClick={() => handleInvite(person.name)}
                  disabled={pending || busyWith === person.name}
                  className="px-3 py-2 rounded-xl bg-[#E8D8C4] text-[#4A3F35] text-xs font-bold hover:bg-[#D9C5B2] disabled:opacity-50 transition-colors cursor-pointer inline-flex items-center gap-1.5 shrink-0"
                >
                  <Send className="w-3.5 h-3.5" />
                  {pending ? t('convo.pending') : t('convo.invite')}
                </button>
              </div>
            );
          })
        )}
      </section>
    </div>
  );
};
