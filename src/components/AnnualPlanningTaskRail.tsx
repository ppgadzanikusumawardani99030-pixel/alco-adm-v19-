import React from 'react';
import { AlertTriangle, CheckCircle2, Circle, Dot } from 'lucide-react';

export type AnnualPlanningTaskStatus =
  | 'COMPLETE'
  | 'CURRENT'
  | 'PENDING'
  | 'NEEDS_REVIEW';

export interface AnnualPlanningTaskRailItem {
  id: string;
  title: string;
  status: AnnualPlanningTaskStatus;
  detail?: string;
}

interface AnnualPlanningTaskRailProps {
  tasks: AnnualPlanningTaskRailItem[];
  onSelectTask: (taskId: string) => void;
}

const statusLabel: Record<AnnualPlanningTaskStatus, string> = {
  COMPLETE: 'Selesai',
  CURRENT: 'Sekarang',
  PENDING: 'Menunggu',
  NEEDS_REVIEW: 'Perlu Review',
};

const getStatusIcon = (status: AnnualPlanningTaskStatus) => {
  if (status === 'COMPLETE') {
    return <CheckCircle2 className="w-4 h-4 text-emerald-600" />;
  }
  if (status === 'NEEDS_REVIEW') {
    return <AlertTriangle className="w-4 h-4 text-amber-600" />;
  }
  if (status === 'CURRENT') {
    return <Dot className="w-6 h-6 text-blue-700" />;
  }
  return <Circle className="w-4 h-4 text-slate-300" />;
};

const getTaskClassName = (status: AnnualPlanningTaskStatus) => {
  if (status === 'COMPLETE') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-950';
  }
  if (status === 'NEEDS_REVIEW') {
    return 'border-amber-300 bg-amber-50 text-amber-950 ring-1 ring-amber-200';
  }
  if (status === 'CURRENT') {
    return 'border-blue-300 bg-blue-50 text-blue-950 ring-1 ring-blue-200';
  }
  return 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50';
};

export const AnnualPlanningTaskRail: React.FC<AnnualPlanningTaskRailProps> = ({
  tasks,
  onSelectTask,
}) => {
  const completedCount = tasks.filter((task) => task.status === 'COMPLETE').length;
  const nextTask =
    tasks.find((task) => task.status === 'NEEDS_REVIEW') ||
    tasks.find((task) => task.status === 'CURRENT') ||
    tasks.find((task) => task.status !== 'COMPLETE');

  return (
    <>
      <aside className="hidden lg:block w-[260px] shrink-0">
        <div className="sticky top-4 bg-white border border-slate-200 rounded-xl shadow-xs p-3 space-y-2">
          <div className="px-1 pb-2 border-b border-slate-100">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
              Alur Step 08
            </p>
            <p className="text-sm font-bold text-slate-900 mt-0.5">
              {completedCount} dari {tasks.length} selesai
            </p>
          </div>

          <div className="space-y-2">
            {tasks.map((task, index) => (
              <button
                key={task.id}
                type="button"
                onClick={() => onSelectTask(task.id)}
                className={`w-full text-left rounded-lg border p-3 transition cursor-pointer ${getTaskClassName(task.status)}`}
              >
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 shrink-0">{getStatusIcon(task.status)}</span>
                  <span className="min-w-0">
                    <span className="block text-[11px] font-semibold text-slate-500">
                      Task {index + 1} • {statusLabel[task.status]}
                    </span>
                    <span className="block text-sm font-bold leading-snug">
                      {task.title}
                    </span>
                    {task.detail && (
                      <span className="block mt-1 text-[11px] font-medium text-slate-600">
                        {task.detail}
                      </span>
                    )}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </aside>

      <div className="lg:hidden bg-white rounded-xl border border-slate-200 shadow-xs p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
              Progress Step 08
            </p>
            <p className="text-sm font-bold text-slate-900">
              {completedCount} dari {tasks.length} selesai
            </p>
            <p className="text-xs text-slate-600 mt-1">
              Berikutnya: {nextTask?.title ?? 'Semua selesai'}
            </p>
          </div>
          {nextTask && (
            <button
              type="button"
              onClick={() => onSelectTask(nextTask.id)}
              className="shrink-0 px-3 py-2 rounded-lg bg-blue-900 text-white text-xs font-bold shadow-xs cursor-pointer"
            >
              Buka
            </button>
          )}
        </div>
      </div>
    </>
  );
};
