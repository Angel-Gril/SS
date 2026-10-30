'use client';

import { useEffect, useState, useRef } from 'react';
import { Loader2, Send, MessageCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/use-toast';
import { api } from '@/lib/api';
import { PlatformShopFilter, type ShopPlatformFilter } from '@/components/shops/platform-shop-filter';

interface Shop { id: string; name: string; platform: string; }
interface Chat { chat_id: string; chat_type: string; created_at: string; unread_count: number; last_message_text?: string; }
interface Message { message_id: number; created_at: string; is_read: boolean; sender: string; data: { text?: string; image?: { url: string } }; }

export default function ChatPage() {
  const [shops, setShops] = useState<Shop[]>([]);
  const [platform, setPlatform] = useState<ShopPlatformFilter>('OZON');
  const [selectedShop, setSelectedShop] = useState('');
  const [chats, setChats] = useState<Chat[]>([]);
  const [loadingChats, setLoadingChats] = useState(false);
  const [selectedChat, setSelectedChat] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [messageText, setMessageText] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const activeShop = useRef(selectedShop);
  activeShop.current = selectedShop;
  const historyRequest = useRef(0);

  useEffect(() => { loadShops(); }, []);
  useEffect(() => {
    setSelectedChat(null); setChats([]); setMessages([]); setMessageText('');
    setLoadingChats(false); setLoadingMessages(false);
    historyRequest.current++;
    if (selectedShop) loadChats();
  }, [selectedShop]);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  async function loadShops() {
    const res = await api.get<Shop[]>('/api/shops');
    if (res.code === 1 && res.data) {
      const ozonShops = res.data.filter((s) => s.platform === 'OZON');
      setShops(ozonShops);
      if (ozonShops.length === 1) setSelectedShop(ozonShops[0]!.id);
    }
  }

  async function loadChats() {
    if (!selectedShop) return;
    const requestedShop = selectedShop;
    setLoadingChats(true);
    const res = await api.get<{ chats: Chat[]; total_unread_count: number }>(`/api/chat/list?shopId=${selectedShop}`);
    if (requestedShop !== activeShop.current) return;
    setLoadingChats(false);
    if (res.code === 1 && res.data) {
      setChats(res.data.chats || []);
    } else {
      toast({ title: '加载会话失败', description: res.msg, variant: 'destructive' });
    }
  }

  async function loadMessages(chatId: string) {
    const requestedShop = selectedShop;
    const requestId = ++historyRequest.current;
    setSelectedChat(chatId);
    setLoadingMessages(true);
    const res = await api.get<{ messages: Message[] }>(`/api/chat/history/${chatId}?shopId=${selectedShop}`);
    if (requestedShop !== activeShop.current || requestId !== historyRequest.current) return;
    setLoadingMessages(false);
    if (res.code === 1 && res.data) {
      setMessages((res.data.messages || []).reverse());
    }
  }

  async function handleSend() {
    if (!messageText.trim() || !selectedChat) return;
    setSending(true);
    const res = await api.post('/api/chat/send', { shopId: selectedShop, chatId: selectedChat, text: messageText });
    setSending(false);
    if (res.code === 1) {
      setMessageText('');
      loadMessages(selectedChat);
    } else {
      toast({ title: '发送失败', description: res.msg, variant: 'destructive' });
    }
  }

  return (
    <div className="flex h-[calc(100vh-80px)] gap-4">
      {/* 左侧：会话列表 */}
      <div className="w-80 flex flex-col border rounded-lg overflow-hidden">
        <div className="p-3 border-b space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="font-medium flex items-center gap-1.5">
              <MessageCircle className="h-4 w-4" /> 客服消息
            </h2>
            <Button size="sm" variant="ghost" onClick={loadChats} disabled={loadingChats || !selectedShop}>
              <RefreshCw className={`h-3.5 w-3.5 ${loadingChats ? 'animate-spin' : ''}`} />
            </Button>
          </div>
          <PlatformShopFilter
            shops={shops}
            platform={platform}
            shopId={selectedShop}
            compact
            allowAllShops={false}
            onPlatformChange={(next) => { setPlatform(next); setSelectedShop(''); }}
            onShopChange={setSelectedShop}
            className="items-stretch"
          />
        </div>
        <div className="flex-1 overflow-y-auto">
          {loadingChats ? (
            <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : chats.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-8">暂无会话</p>
          ) : (
            chats.map((chat) => (
              <button
                key={chat.chat_id}
                onClick={() => loadMessages(chat.chat_id)}
                className={`w-full text-left px-3 py-2.5 border-b hover:bg-muted/50 transition-colors ${selectedChat === chat.chat_id ? 'bg-muted' : ''}`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium truncate">{chat.chat_id.slice(0, 12)}...</span>
                  {chat.unread_count > 0 && <Badge variant="destructive" className="text-[10px] h-4 px-1">{chat.unread_count}</Badge>}
                </div>
                {chat.last_message_text && (
                  <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{chat.last_message_text}</p>
                )}
              </button>
            ))
          )}
        </div>
      </div>

      {/* 右侧：消息区 */}
      <div className="flex-1 flex flex-col border rounded-lg overflow-hidden">
        {!selectedChat ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <p>选择一个会话开始聊天</p>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {loadingMessages ? (
                <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>
              ) : messages.length === 0 ? (
                <p className="text-center text-sm text-muted-foreground">暂无消息</p>
              ) : (
                messages.map((msg) => (
                  <div key={msg.message_id} className={`flex ${msg.sender === 'Seller' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[70%] rounded-lg px-3 py-2 text-sm ${
                      msg.sender === 'Seller' ? 'bg-primary text-primary-foreground' :
                      msg.sender === 'System' ? 'bg-muted text-muted-foreground italic' :
                      'bg-muted'
                    }`}>
                      {msg.data.text && <p>{msg.data.text}</p>}
                      {msg.data.image && <img src={msg.data.image.url} alt="" className="max-w-full rounded mt-1" />}
                      <p className={`text-[10px] mt-1 ${msg.sender === 'Seller' ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                        {new Date(msg.created_at).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>
            <div className="border-t p-3 flex gap-2">
              <Input
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                placeholder="输入消息..."
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                className="flex-1"
              />
              <Button onClick={handleSend} disabled={sending || !messageText.trim()}>
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
