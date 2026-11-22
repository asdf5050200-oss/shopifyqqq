import React, { useState } from "react";
import { Download, Share, WifiOff, X } from "lucide-react";
import { useOnlineStatus, usePWAInstall } from "../hooks/usePWA";

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  const handleClick = async () => {
    if (isInstallable) {
      const accepted = await install();
      if (!accepted) return;
    } else {
      setShowGuide(true);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer transition-colors"
      >
        <Download className="w-3.5 h-3.5" />
        <span>安装 App</span>
      </button>

      {showGuide && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="w-full sm:max-w-sm bg-[#111827] border border-slate-800 rounded-t-xl sm:rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-3">
                <img
                  src="/pwa-192x192.png"
                  alt="汇通财经"
                  className="w-9 h-9 rounded-lg bg-white object-cover"
                />
                <div>
                  <h3 className="text-sm font-semibold text-slate-100">安装汇通财经</h3>
                  <p className="text-xs text-slate-400">桌面 / 移动端独立应用</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="p-1 text-slate-400 hover:text-slate-200 cursor-pointer"
                aria-label="关闭"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {isIOS ? (
              <div className="p-3 rounded-lg bg-[#0B0F17] border border-slate-800 flex items-start gap-2.5 text-xs">
                <Share className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                <div>
                  <div className="font-medium text-slate-100">iOS Safari</div>
                  <p className="text-slate-400 mt-1">分享 → 添加到主屏幕</p>
                </div>
              </div>
            ) : (
              <div className="p-3 rounded-lg bg-[#0B0F17] border border-slate-800 text-xs">
                <div className="font-medium text-slate-100">浏览器安装</div>
                <p className="text-slate-400 mt-1">地址栏或菜单 → 安装应用 / 添加到主屏幕</p>
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="w-full py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs font-medium cursor-pointer"
            >
              关闭
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div className="fixed bottom-16 lg:bottom-4 left-4 right-4 sm:right-auto z-50 flex items-center gap-2 rounded-lg bg-amber-600 px-3.5 py-2 text-xs font-medium text-white shadow-lg">
      <WifiOff className="w-3.5 h-3.5 shrink-0" />
      <span>离线模式 · 显示本地缓存行情</span>
    </div>
  );
};
