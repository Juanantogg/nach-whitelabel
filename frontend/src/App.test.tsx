import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from './App';

describe('App', () => {
  it('renderiza el título del proyecto', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: /nach-whitelabel/i })).toBeInTheDocument();
  });
});
