import React, { useEffect, useState } from 'react';
import { MessageSquare, UserRound, Send, Check, X, RefreshCw } from 'lucide-react';
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
  const [rooms, setRooms] = useState<PairRoomSummary[]>([]);
  const [people, setPeople] = useState<PresenceRecord[]>([]);
  const [incoming, setIncoming] = useState<ChatInvite[]>([]);
  const [outgoing, setOutgoing] = useState<ChatInvite[]>([]);
  const [busyWith, setBusyWith] = useState('');
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
      showToast('對方已同意', `開始跟 ${accepted.to} 聊天`, 'success');
      onOpenRoom(roomId, accepted.to);
    })();
  }, [outgoing, me]);

  const declined = outgoing.find((i) => i.status === 'declined');
  useEffect(() => {
    if (!declined) return;
    showToast('對方婉拒了邀請', declined.to, 'info');
    dismissInvite(declined.id);
  }, [declined]);

  const handleInvite = async (target: string) => {
    if (busyWith) return;
    setBusyWith(target);
    try {
      await sendChatInvite(me, target);
      showToast('已送出邀請', `等待 ${target} 回應`, 'info');
    } catch (err: any) {
      showToast('邀請失敗', err?.message || '請稍後再試', 'error');
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

  return (
    <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pb-4 animate-fade-in">
      {/* Invitations addressed to me come first — they are time-sensitive */}
      {incoming.map((invite) => (
        <div
          key={invite.id}
          className="p-4 rounded-2xl bg-[#EFE2D2] border-l-[3px] border-[#8E7256] space-y-3"
        >
          <p className="text-sm font-bold text-[#4A3F35]">
            {invite.from} 想跟你聊天
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleRespond(invite, false)}
              className="px-4 py-2 rounded-xl bg-white text-[#7A6C5E] text-xs font-bold hover:bg-[#F5EFE6] transition-colors cursor-pointer inline-flex items-center gap-1.5"
            >
              <X className="w-3.5 h-3.5" />
              婉拒
            </button>
            <button
              type="button"
              onClick={() => handleRespond(invite, true)}
              className="flex-1 milk-tea-btn-primary py-2 rounded-xl text-xs font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Check className="w-3.5 h-3.5" />
              同意並開始
            </button>
          </div>
        </div>
      ))}

      <section className="space-y-2">
        <h2 className="text-xs font-bold text-[#7A6C5E] px-1">我的對話</h2>

        {isLoading ? (
          <div className={`${card} p-6 flex items-center justify-center gap-2 text-xs text-[#7A6C5E]`}>
            <RefreshCw className="w-4 h-4 animate-spin" />
            載入中…
          </div>
        ) : rooms.length === 0 ? (
          <div className={`${card} p-6 text-center text-xs text-[#A69684]`}>
            還沒有對話，從下面邀請一個人開始
          </div>
        ) : (
          rooms.map((room) => {
            const partner = partnerOf(room.participants, me);
            const online = people.some((p) => sameName(p.name, partner));
            return (
              <button
                key={room.id}
                type="button"
                onClick={() => onOpenRoom(room.id, partner)}
                className={`${card} w-full p-4 flex items-center gap-3 hover:border-[#A68B6D] transition-colors text-left cursor-pointer`}
              >
                <div className="w-10 h-10 rounded-2xl bg-[#E8D8C4] text-[#5C4B3A] flex items-center justify-center shrink-0">
                  <MessageSquare className="w-5 h-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold text-[#4A3F35] truncate">{partner}</div>
                  <div className="text-[11px] text-[#7A6C5E]">{online ? '線上' : '離線'}</div>
                </div>
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    online ? 'bg-emerald-500' : 'bg-[#D9C5B2]'
                  }`}
                />
              </button>
            );
          })
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-xs font-bold text-[#7A6C5E] px-1">現在線上</h2>

        {invitable.length === 0 ? (
          <div className={`${card} p-6 text-center text-xs text-[#A69684]`}>
            目前沒有其他人在線上
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
                  {pending ? '等待回應' : '邀請'}
                </button>
              </div>
            );
          })
        )}
      </section>
    </div>
  );
};
