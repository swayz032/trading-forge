import unittest

from indicator.research.splits import fixed_chronological_split, rolling_walk_forward


DAYS = tuple(f"2026-01-{i:02d}" for i in range(1, 31))


class ResearchSplitTests(unittest.TestCase):
    def test_fixed_split_is_chronological_and_disjoint(self):
        s = fixed_chronological_split(DAYS, train_days=18, validation_days=6, holdout_days=6)
        self.assertLess(s.train[-1], s.validation[0])
        self.assertLess(s.validation[-1], s.holdout[0])
        self.assertFalse(set(s.train) & set(s.validation))
        self.assertFalse(set(s.validation) & set(s.holdout))
        self.assertFalse(set(s.train) & set(s.holdout))
        self.assertEqual(s.train + s.validation + s.holdout, DAYS)

    def test_random_or_unsorted_days_are_rejected(self):
        with self.assertRaises(ValueError):
            fixed_chronological_split(("2026-01-02", "2026-01-01", "2026-01-03"), train_days=1, validation_days=1, holdout_days=1)

    def test_duplicate_day_is_rejected(self):
        with self.assertRaises(ValueError):
            fixed_chronological_split(("2026-01-01", "2026-01-01", "2026-01-02"), train_days=1, validation_days=1, holdout_days=1)

    def test_walk_forward_embargo_separates_train_from_test(self):
        folds = rolling_walk_forward(DAYS, train_window_days=10, test_window_days=5, step_days=5, embargo_days=2)
        self.assertGreaterEqual(len(folds), 2)
        for f in folds:
            self.assertEqual(len(f.train), 10)
            self.assertEqual(len(f.embargo), 2)
            self.assertEqual(len(f.test), 5)
            self.assertLess(f.train[-1], f.embargo[0])
            self.assertLess(f.embargo[-1], f.test[0])
            self.assertFalse(set(f.train) & set(f.test))

    def test_walk_forward_is_deterministic(self):
        a = rolling_walk_forward(DAYS, train_window_days=10, test_window_days=5, step_days=5, embargo_days=1)
        b = rolling_walk_forward(DAYS, train_window_days=10, test_window_days=5, step_days=5, embargo_days=1)
        self.assertEqual(a, b)


if __name__ == '__main__':
    unittest.main()
