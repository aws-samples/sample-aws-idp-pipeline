import { useTranslation } from 'react-i18next';
import { Box } from 'lucide-react';

interface WelcomeScreenProps {
  voiceChatPanel: React.ReactNode;
  inputBox: React.ReactNode;
}

export default function WelcomeScreen({
  voiceChatPanel,
  inputBox,
}: WelcomeScreenProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col items-center h-full p-6 max-w-3xl mx-auto w-full">
      <div className="flex-[3]" />
      <div className="mb-6">
        <Box className="w-10 h-10 text-blue-500" strokeWidth={1.5} />
      </div>
      <h3 className="text-xl font-light text-slate-800 dark:text-white mb-2 tracking-tight">
        {t('chat.welcomeTitle')}
      </h3>
      <p className="text-sm text-slate-500 dark:text-slate-400 text-center max-w-md">
        {t('chat.welcomeDescription')}
      </p>
      <div className="mt-10 w-full flex flex-col items-center">
        {voiceChatPanel}
        {inputBox}
        <p className="text-xs text-slate-400 dark:text-slate-500 text-center mt-3">
          {t('chat.enterToSend')}
        </p>
      </div>
      <div className="flex-[5]" />
    </div>
  );
}
