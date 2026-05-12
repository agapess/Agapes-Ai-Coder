import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { PlanCard } from './PlanCard';
import type { ProjectPlan } from '../../types';

const PLAN: ProjectPlan = {
  summary:  'A weather dashboard with current temperature and forecasts',
  files:    ['index.html', 'style.css', 'app.js'],
  uses:     ['OpenWeatherMap API', 'Chart.js'],
  features: ['current temp', '5-day forecast', 'city search'],
};

describe('PlanCard', () => {
  it('renders the summary', () => {
    render(<PlanCard plan={PLAN} onConfirm={() => {}} onReject={() => {}} />);
    expect(screen.getByText(/weather dashboard/i)).toBeInTheDocument();
  });

  it('renders all files', () => {
    render(<PlanCard plan={PLAN} onConfirm={() => {}} onReject={() => {}} />);
    expect(screen.getByText('index.html')).toBeInTheDocument();
    expect(screen.getByText('style.css')).toBeInTheDocument();
  });

  it('renders uses list', () => {
    render(<PlanCard plan={PLAN} onConfirm={() => {}} onReject={() => {}} />);
    expect(screen.getByText(/OpenWeatherMap/i)).toBeInTheDocument();
  });

  it('calls onConfirm when confirm button clicked', () => {
    const onConfirm = vi.fn();
    render(<PlanCard plan={PLAN} onConfirm={onConfirm} onReject={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /yes, build it/i }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('calls onReject when cancel button clicked', () => {
    const onReject = vi.fn();
    render(<PlanCard plan={PLAN} onConfirm={() => {}} onReject={onReject} />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onReject).toHaveBeenCalledOnce();
  });

  it('opens refine mode when change button clicked', () => {
    render(<PlanCard plan={PLAN} onConfirm={() => {}} onReject={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /change something/i }));
    expect(screen.getByPlaceholderText(/e\.g\. use TypeScript/i)).toBeInTheDocument();
  });
});
